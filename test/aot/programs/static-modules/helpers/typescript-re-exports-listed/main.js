// The same barrel, listed: the keys stand in the order in which `exports.a = exports.B = void 0` created them.
const index = require("./index"),
  lib = require("./lib");
console.log(index.a, typeof index.B, Object.keys(index).join());
lib.setA(2);
console.log(index.a);
