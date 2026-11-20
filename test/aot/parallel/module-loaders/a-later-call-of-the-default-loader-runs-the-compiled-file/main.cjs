const Module = require("node:module");
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) { setTimeout(() => { original(module, filename); console.log("later", JSON.stringify(module.exports)); }, 1); };
if (process.argv.length > 99) require("./subject.js");
console.log("at once", JSON.stringify(require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js")));
