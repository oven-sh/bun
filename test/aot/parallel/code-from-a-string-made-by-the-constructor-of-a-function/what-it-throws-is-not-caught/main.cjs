"use strict";
var lib = require("./lib.cjs");
console.log(lib.twice(4));
lib.make(JSON.parse("\"process.mainModule.children[0].exports.twice = function (n) { return -n; };\""))();
console.log(lib.twice(4));
// DECLARED: docs/compiler/compatibility.mdx, "Code from strings": nothing in the program names an evaluator, so process.mainModule is undefined, as in an executable built with --no-aot. bun run prints "8" and "-4".
/* Output:
8
exit code 1
TypeError: undefined is not an object (evaluating 'process.mainModule.children')
*/
