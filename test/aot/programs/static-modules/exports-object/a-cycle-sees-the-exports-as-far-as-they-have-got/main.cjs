// A cycle sees the exports as far as they have got.
const a = require("./a.cjs"),
  b = require("./b.cjs");
console.log(a.sawB, b.sawA, b.later());
