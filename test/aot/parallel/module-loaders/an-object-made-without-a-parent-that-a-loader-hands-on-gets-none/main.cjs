// `new Module(filename)` has no parent, and none comes to it: not while the file runs into it, and not when a written require() asks for the file later.
const Module = require("node:module");
const original = Module._extensions[".js"];
let other;
Module._extensions[".js"] = function (module, filename) {
  other = new Module(filename);
  original(other, filename);
  module.exports = other.exports;
};
console.log(JSON.stringify(require("./" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"subject"') + ".js")));
console.log(JSON.stringify(require("./subject.js")), String(other.parent));
