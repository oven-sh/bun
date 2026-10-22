// A require in a branch at the top enters the cycle at b, ahead of the require of a that every run passes.
if (process.argv.length < 99) require("./b.cjs");
const a = require("./a.cjs"),
  b = require("./b.cjs");
console.log(a.sawB, b.sawA);
