// Behind `delete module.exports` the module exports `undefined`, and `exports` goes on naming the object it was born with.
console.log(typeof require("./deleted.cjs"), seen.a, seen.b, seen.c);
console.log(typeof require("./stored-again.cjs"), require("./stored-again.cjs").a);
