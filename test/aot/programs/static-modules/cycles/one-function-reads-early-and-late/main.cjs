// One function of b reads `a.late`. a calls it ahead of its only store to the name and behind it: the name holds a constant, is stored once, at the top, and still has two values.
// STATISTIC: ModulesWithNames >= 2
const a = require("./a.cjs");
console.log(a.before, a.after);
