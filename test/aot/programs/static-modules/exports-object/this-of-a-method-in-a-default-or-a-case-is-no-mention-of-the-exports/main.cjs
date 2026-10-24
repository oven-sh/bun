// `this` of a method stands in the default of a pattern, in a computed key of one, in the test of a `case`, in what a class extends: it is the receiver, and the file keeps its names.
// STATISTIC: ModulesWithNames >= 1
const k = require("./k.cjs");
const c = new k.C();
console.log(k.n, c.m({}), c.m({ t: 2 }), c.first([]), c.keyed({ t: 9 }), c.parameter({}), c.kind(7), c.kind(8), new (c.below())().base);
console.log(k.plain(), k.top, k.match);
