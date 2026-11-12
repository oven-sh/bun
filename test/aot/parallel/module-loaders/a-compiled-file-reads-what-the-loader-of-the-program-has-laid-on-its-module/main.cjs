const Module = require("node:module");
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) { module.laid = "laid by the loader"; return original(module, filename); };
if (process.argv.length > 99) require("./subject.js");
console.log(require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js").seen);
