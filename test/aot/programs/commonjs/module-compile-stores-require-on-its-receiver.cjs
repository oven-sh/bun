// module._compile(text, name) runs the text as the body of the module and leaves `require` on the module it was called on.
const Module = require("node:module");
const made = new Module("/virtual/made.cjs");
made.filename = "/virtual/made.cjs";
made.paths = [];
console.log(Object.hasOwn(made, "require"), typeof made.require);
made._compile('exports.sep = require("node:path").sep; exports.same = module.require === require || typeof require;', "/virtual/made.cjs");
console.log(Object.keys(made.exports).join(), made.exports.sep === require("node:path").sep);
console.log(typeof made.require, typeof made.require("node:path").join);
