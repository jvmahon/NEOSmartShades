'use strict';
var net = require('net');
const pkg = require("./package.json");
const queue = require("queue");
const fs = require('fs');

var sendQueue = queue({autostart:true, concurrency:1})
		
var exports = module.exports;
var globals = [];																																
module.exports.globals = globals;

var Accessory, Service, Characteristic, UUIDGen;

module.exports = function (homebridge) {
    console.log("homebridge API version: " + homebridge.version);

    // Accessory must be created from PlatformAccessory Constructor
    Accessory = homebridge.platformAccessory;

    // Service and Characteristic are from hap-nodejs
    Service = homebridge.hap.Service;
    Characteristic = homebridge.hap.Characteristic;
    UUIDGen = homebridge.hap.uuid;

    homebridge.registerPlatform("homebridge-NeoSmartBlinds", "NEOShades", NEOShadePlatform, true);
}

function NEOShadePlatform(log, config, api) {
	this.log = log;
    this.config = config;

	globals.log = log; 
	globals.platformConfig = config; // Platform variables from config.json
	globals.api = api; // _accessories, _platforms, _configurableAccessories, _dynamicPlatforms, version, serverVersion, user, hap, hapLegacyTypes,platformAccessory,_events, _eventsCount
}


NEOShadePlatform.prototype = {
    accessories: async function (callback)  {
        var foundAccessories = [];
		var that = this;

		globals.log("Configuring NEOSmartPlatform:");

		this.config?.shades?.forEach(currentShade => {
			globals.log("Setting up shade with config.json data set to:" + JSON.stringify(currentShade));

			try  {
				var accessory = new NEOShadeAccessory(that.log, that.config, currentShade);
			} catch(error) {
				console.log( "** Error ** creating new NEO Smart Blinds in file index.js."); 
				throw error
			}	

			foundAccessories.push(accessory);
		})

		callback(foundAccessories);
	}
}

function NEOShadeAccessory(log, platformConfig, currentShade) {
    this.config = currentShade;
	this.platformConfig = platformConfig
    this.name = currentShade.name
    this.model = currentShade.motorType;
	this.uuid_base = currentShade.code;
}

NEOShadeAccessory.prototype = {

    identify: function (callback) {
        callback();
    },

    getServices: function () {
        var services = [];
		// The following function sets up the HomeKit 'services' for particular shade and returns them in the array 'services'. 
		setupShadeServices(this, services);
        return services;
    }
}

var setupShadeServices = function (that, services)
{
	function send(command) {
			function sendfunction(cb) {
				var telnetClient = net.createConnection(8839, that.platformConfig.host, ()=>  {
						telnetClient.write(command +"\r", ()=>  {
								var now = new Date();
								console.log(`Sent Command: ${command} at time: ${now.toLocaleTimeString()}`) 
								setTimeout( ()=> {cb()}, 500);
							});
					});
			}
			sendQueue.push(sendfunction)
		}
	
	// Function to ensure that the file or folder exists
	function ensureFileOrFolderExists(filePath) {
		const folderPath = filePath.substring(0, filePath.lastIndexOf('/'));

		if (!fs.existsSync(folderPath)) {
			fs.mkdirSync(folderPath, { recursive: true });
		}

		if (!fs.existsSync(filePath)) {
			fs.writeFileSync(filePath, '', 'utf8');
		}
	}

	// Function to load state for a specific ID from file
	function loadStateForId(filePath, id) {
		try {
			const data = fs.readFileSync(filePath, 'utf8');
			const lines = data.split('\n');

			for (const line of lines) {
				const [fileId, value] = line.split(',').map(item => item.trim());
				if (fileId === id) {
					return parseInt(value);
				}
			}

			// If ID not found, return null or any default value as needed
			return 50;
		} catch (err) {
			if(err.code == "ENOENT"){
				console.log("No State file exists.")
				return 50;
			}
			else{
				console.error('Error loading state for ID from file:', err);
				return 50;
			}
			
		}
	}

	
	function saveStateForId(filePath, id, value) {
		try {
			// Ensure that the file or folder exists
			ensureFileOrFolderExists(filePath);
	
			// Read existing file content
			let data = fs.readFileSync(filePath, 'utf8');
			const lines = data.split('\n');
	
			// Update value for the specified ID or add it if not present
			let found = false;
			for (let i = 0; i < lines.length; i++) {
				const [fileId, _] = lines[i].split(',').map(item => item.trim());
				if (fileId === id) {
					lines[i] = `${id}, ${value}`;
					found = true;
					break;
				}
			}
			if (!found) {
				lines.push(`${id}, ${value}`);
			}
	
			// Save updated content back to the file
			data = lines.join('\n');
			fs.writeFileSync(filePath, data, 'utf8');
		} catch (err) {
			console.error('Error saving state for ID to file:', err);
		}
	}

	let filePath = 'files/states.txt'

	let Characteristic 	= globals.api.hap.Characteristic;
	let Service 		= globals.api.hap.Service;
	
	// And add a basic Accessory Information service		
	var informationService = new Service.AccessoryInformation();
	informationService
		.setCharacteristic(Characteristic.Manufacturer, "NEO Smart")
		.setCharacteristic(Characteristic.Model, "Roller Shade")
		.setCharacteristic(Characteristic.Name, that.config.name )
		.setCharacteristic(Characteristic.SerialNumber, that.config.code )
	
	var thisService = new Service.WindowCovering()
	
	var currentPosition = thisService.getCharacteristic(Characteristic.CurrentPosition)
	var targetPosition = thisService.getCharacteristic(Characteristic.TargetPosition)
	var positionState = thisService.getCharacteristic(Characteristic.PositionState)
	

	const currentState = loadStateForId(filePath, that.config.code);
	console.log(`Current state for ID ${that.config.code}:`, currentState);

	currentPosition.value = currentState //50;
	targetPosition.value =  currentState//50;
	positionState.value = 2;
	
	targetPosition
		.on('set', function(value, callback, context) {
			switch(value) {
				case 0: // Close the Shade!
					send(that.config.code + "-dn!" + (that.config.motorType ? that.config.motorType : "bf") )
					positionState.updateValue(0);
					setTimeout( function(){
						targetPosition.updateValue(0);
						currentPosition.updateValue(0)
					}, 25000);
					positionState.updateValue(2);
					saveStateForId(filePath, that.config.code, value);
					console.log(`Updated state for ID ${that.config.code} with value ${value}.`);
					break;
				case 24:
				case 25:
				case 26: // Move Shade to Favorite position!
					send(that.config.code + "-gp" + (that.config.motorType ? that.config.motorType : "bf"))

					if(thisService.getCharacteristic(Characteristic.CurrentPosition) > 25){
						positionState.updateValue(0);
					}
					else{
						positionState.updateValue(1);
					}

					setTimeout( function(){
						targetPosition.updateValue(25);
						currentPosition.updateValue(25)
					}, 25000);
					positionState.updateValue(2);
					saveStateForId(filePath, that.config.code, value);
					console.log(`Updated state for ID ${that.config.code} with value ${value}.`);
					break					
					
				case 100: // Open the shade
					send(that.config.code + "-up!" + (that.config.motorType ? that.config.motorType : "bf"))
					positionState.updateValue(1);
					// NEO controller doesn't detect actual position, reset shade after 20 seconds to show the user the shade is at half-position - i.e., neither up or down!
					setTimeout( function(){
						targetPosition.updateValue(100);
						currentPosition.updateValue(100)
					}, 25000);
					positionState.updateValue(2);
					saveStateForId(filePath, that.config.code, value);
					console.log(`Updated state for ID ${that.config.code} with value ${value}.`);
					break;
				default:
					// Do nothing if any ohter value is selected!
					console.log("*Debug* - You must slide window covering all the way up or down or to 25% (favorite position) for anything to happen!");
					break;
			}
			callback(null);
		} );		

	services.push(thisService);
	services.push(informationService);
}

module.exports.platform = NEOShadePlatform;
