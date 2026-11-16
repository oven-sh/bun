// What is laid over a method of require is a parameter.
"use strict";
const lib = require("./lib.cjs");
function lay(resolve) { require.resolve = resolve; }
lay(function () { return this.main; });
const main = require.resolve("./lib.cjs");
console.log(lib.helper(3), typeof main, main.children.length);
for (const child of main.children) child.exports.helper = () => 99;
console.log(lib.helper(3));
