// Behind a cycle every read through the holder is a read at that moment: a counter that the module keeps in `exports.n` is seen to move by the module that required it half done. What a pattern took stays.
// The exports of both modules were meant to be variables. Those of one are.
// STATISTIC: ModulesWithNames >= 1
const a = require("./a.cjs"),
  b = require("./b.cjs");
console.log(b.read());
a.bump();
console.log(a.viaB());
b.bumpTwice();
console.log(b.read(), a.n);
