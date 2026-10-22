// k.cjs requires e.mjs in the middle of its body, and e.mjs imports names and the default of k.cjs. The names are copies of what k has stored so far. The default is the exports object itself, which the rest of k's body fills.
// STATISTIC: Faces >= 1
const k = require("./k.cjs");
console.log(k.seen, k.readLater());
