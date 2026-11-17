// The name of the function that is laid over a method of require is stored to a second time.
"use strict";
const lib = require("./lib.cjs");
let resolve = () => undefined;
resolve = function () { return this.main; };
require.resolve = resolve;
const main = require.resolve("./lib.cjs");
console.log(lib.helper(3), typeof main, main.children.length);
for (const child of main.children) child.exports.helper = () => 99;
console.log(lib.helper(3));
