const Module = require("node:module");
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) { const fresh = new Module(filename); original(fresh, filename); module.exports = { through: fresh.exports.value }; };
if (process.argv.length > 99) require("./subject.js");
console.log(JSON.stringify(require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js")));
