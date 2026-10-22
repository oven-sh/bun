// The require that opens the cycle stands in a function, which the body calls half way: the other module sees the first half.
// STATISTIC: ModulesWithState >= 1
const a = require("./a.cjs");
console.log(a.saw, require("./b.cjs").later());
