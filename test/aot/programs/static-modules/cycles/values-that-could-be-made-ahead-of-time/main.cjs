// Exports whose values need nothing of the run: a number, a string, a literal, an array, a function without captures, a class. Each is stored once, at the top. A module that looks in the middle of a cycle finds none of them.
const a = require("./a.cjs");
console.log(a.early);
console.log(require("./b.cjs").types());
