// While a runs, b stores to names of a: one that a has stored, one that a adds to afterwards, and one that a stores only later. a reads what b stored, and its own later store wins. All by names.
// STATISTIC: ModulesWithNames >= 2
const a = require("./a.cjs");
console.log(a.afterB, require("./b.cjs").read());
