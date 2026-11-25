const Module = require("node:module");
const asked = [];
const original = Module.prototype.require;
Module.prototype.require = function (request) { asked.push(request); return original.call(this, request); };
if (process.argv.length > 99) require("./subject.js");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js");
console.log(got.value, asked.join());
