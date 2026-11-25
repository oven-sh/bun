"use strict";
var lib = require("./lib.cjs");
var first = lib.twice(4);
var how = "ran";
try {
  lib.make(JSON.parse("\"process.mainModule.children[0].exports.twice = function (n) { return -n; };\""))();
} catch (error) {
  how = error.name;
}
console.log(first, lib.twice(4), how);
// DECLARED: docs/compiler/compatibility.mdx, "Code from strings": nothing in the program names an evaluator, so process.mainModule is undefined, as in an executable built with --no-aot. bun run prints "8 -4 ran".
/* Output:
8 8 TypeError
*/
