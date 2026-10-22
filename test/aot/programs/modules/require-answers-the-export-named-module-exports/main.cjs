// require() of an ES module that exports a value under the name "module.exports" answers that value, unless it is undefined or null. No compiled code reads the export: the loader does.
const replaced = require("./answers-an-object.mjs");
console.log(typeof replaced, replaced.kind, replaced.other);
const nothing = require("./answers-nothing.mjs");
console.log(typeof nothing, Object.keys(nothing).join(), nothing.other, nothing.__esModule);
const marked = require("./has-its-own-mark.mjs");
console.log(marked.__esModule, marked.default, Object.keys(marked).join());
const calledLater = require("./answers-a-function.mjs");
console.log(typeof calledLater, calledLater(20));
