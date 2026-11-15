// The loader of the program hands the default loader the object that require() made, and names another file. That file runs, and the object is its `module`.
const Module = require("node:module");
const path = require("node:path");
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  module.laid = "by the loader";
  original(module, path.join(path.dirname(filename), "other.js"));
  console.log(module.seen, module.loaded);
};
if (process.argv.length > 99) require("./other.js");
if (process.argv.length > 99) require("./subject.js");
console.log(JSON.stringify(require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"subject"') + ".js")));
