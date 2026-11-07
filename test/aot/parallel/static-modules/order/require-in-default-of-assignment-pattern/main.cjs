// `({ a = require(K) } = bag)`: the default of an assignment pattern is evaluated only where the bag has nothing for the target, so K runs on some runs of the body.
const m = require("./m.cjs");
console.log(m.a, m.b, m.c, m.d, m.e);
