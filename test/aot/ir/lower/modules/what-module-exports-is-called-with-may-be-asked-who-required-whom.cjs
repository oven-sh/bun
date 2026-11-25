// `module.exports()` is a call through `module`: what is called gets the module object as `this` and may ask it who required whom, so the require() calls of the program are recorded.
// RUN: lower
// CHECK: RecordRequire

// FILE: main.cjs
require("./other.cjs");
module.exports = function () { return this.children.length; };
console.log(module.exports());

// FILE: other.cjs
module.exports = { other: true };
