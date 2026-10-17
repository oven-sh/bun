// The entry point is sloppy CommonJS: it deletes a name, names variables `let`, `yield` and `static`, and writes legacy octal literals.
var assert = require('assert');
var a = 1;
var gone = delete a;
var package = 1, interface = 2, let = 3, static = 4, yield = 5;
console.log(gone, a, package + interface + let + static + yield, 010, 0777, typeof assert.ok);
