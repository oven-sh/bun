const Module = require("node:module");
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  const handed = filename.includes("other") ? new Module(filename) : module;
  try { original(handed, filename); } catch (error) { console.log("caught", error.message); original(handed, filename); }
  if (handed !== module) module.exports = handed.exports;
};
if (process.argv.length > 99) { require("./same-object.js"); require("./other-object.js"); }
for (const word of ["same", "other"]) {
  const name = "./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? JSON.stringify(word)) + "-object.js";
  let got; try { got = JSON.stringify(require(name)); } catch (error) { got = "threw " + error.message; }
  console.log(word, got);
}
