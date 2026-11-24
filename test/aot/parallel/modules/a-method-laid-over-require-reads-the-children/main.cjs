// A function that is laid over a method of require gets require as its receiver: it sees the main module and its children.
"use strict";
const lib = require("./lib.cjs");
require.resolve = function () { return this.main; };
const main = require.resolve("./lib.cjs");
console.log(lib.helper(3), typeof main, main.children.length);
for (const child of main.children) child.exports.helper = () => 99;
console.log(lib.helper(3));
