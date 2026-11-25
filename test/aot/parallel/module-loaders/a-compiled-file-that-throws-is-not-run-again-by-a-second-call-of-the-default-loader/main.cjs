const Module = require("node:module");
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) { try { original(module, filename); } catch (error) { console.log("caught", error.message); original(module, filename); } };
if (process.argv.length > 99) require("./subject.js");
const name = "./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js";
let got; try { got = JSON.stringify(require(name)); } catch (error) { got = "threw " + error.message; }
console.log(got);
