globalThis.again = () => typeof require("./lamp.mjs").__esModule;
const lamp = require("./lamp.mjs");
console.log("behind", typeof lamp.__esModule);
