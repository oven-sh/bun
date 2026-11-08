const Module = require("node:module");
const original = Module._extensions[".js"];
let handed;
Module._extensions[".js"] = function (module, filename) {
  handed = new Module(filename);
  try { original(handed, filename); } catch (error) { console.log("caught", error.message); }
  module.exports = handed.exports;
};
if (process.argv.length > 99) require("./subject.js");
const got = require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? "\"subject\"") + ".js");
got.laidLater = 1;
console.log(JSON.stringify(got), Object.isFrozen(handed.exports), got === handed.exports);
