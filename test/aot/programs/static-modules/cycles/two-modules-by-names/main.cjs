// Two CommonJS modules require each other at the top. The one that is required while its body runs shows the names it has stored so far: a name that is not stored yet reads undefined, and the same read gives the value once the cycle has closed. Nobody looks at an exports object here, only at names.
// STATISTIC: ModulesWithNames >= 2
// STATISTIC: ModulesWithoutState >= 2
const a = require("./a.cjs");
const b = require("./b.cjs");
console.log(a.early, a.late, a.fromB);
console.log(b.earlyOfA, b.lateOfA, b.typeOfLateFunction);
console.log(b.readLateOfA(), b.callLateFunctionOfA());
