// `var e = exports` where the variable is stored again, read early, or leaks.
const stored = require("./stored"), early = require("./early"), leaks = require("./leaks");
console.log(stored.a, stored.seen, early.before, early.a, leaks.a, leaks.keys);
