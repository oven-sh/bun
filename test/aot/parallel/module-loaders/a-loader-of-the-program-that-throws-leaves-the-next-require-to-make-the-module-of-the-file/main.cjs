const Module = require("node:module");
const original = Module._extensions[".js"];
let times = 0;
Module._extensions[".js"] = function (module, filename) { times++; module.laid = "laid " + times; if (times === 1) throw new Error("made up"); return original(module, filename); };
if (process.argv.length > 99) require("./subject.js");
const name = "./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js";
try { require(name); } catch (error) { console.log("threw", error.message); }
console.log(require(name).seen, times);
