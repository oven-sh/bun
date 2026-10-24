// The exports object of a module that is half done, looked at as an object: its keys, `in`, a spread, JSON. It is the object that the later stores of the module fill, and the one that every later require answers.
const a = require("./a.cjs"),
  b = require("./b.cjs");
console.log(b.keysOfA, b.hasLast, b.json, b.held === a);
console.log(a.sawB);
console.log(b.later());
