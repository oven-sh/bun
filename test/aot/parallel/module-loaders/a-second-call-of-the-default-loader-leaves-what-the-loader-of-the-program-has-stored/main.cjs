const Module = require("node:module");
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) { original(module, filename); module.exports = { wrapped: module.exports.value }; original(module, filename); };
if (process.argv.length > 99) require("./subject.js");
console.log(JSON.stringify(require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js")));
