// No require() stands in front of the file that the default loader is handed here, and the object is one that the program made. It is the file's `module` all the same.
const Module = require("node:module");
const path = require("node:path");
const original = Module._extensions[".js"];
Module._extensions[".js"] = function (module, filename) {
  const file = path.join(path.dirname(filename), "other.js");
  const other = new Module(file, module);
  other.laid = "by the loader";
  original(other, file);
  console.log(other.seen, typeof Object.getOwnPropertyDescriptor(other, "exports")?.get);
  module.exports = other.exports;
};
if (process.argv.length > 99) require("./other.js");
if (process.argv.length > 99) require("./subject.js");
console.log(JSON.stringify(require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"subject"') + ".js")));
