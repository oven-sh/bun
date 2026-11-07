// new Module(id) makes an instance that inherits require.
const Module = require("node:module");
const made = new Module("/virtual/made.js");
console.log(typeof made.require, made.id, made instanceof Module, made.constructor === Module);
