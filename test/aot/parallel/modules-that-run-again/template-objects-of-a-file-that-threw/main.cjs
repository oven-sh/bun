// A CommonJS file whose body throws runs again at the next require(). `bun run` reads it again, so each tagged template in it has another object in the second run.
try { require("./thrower.cjs"); } catch (error) { console.log(error.message); }
require("./thrower.cjs");
console.log(globalThis.seen.length, globalThis.seen[0] === globalThis.seen[1], globalThis.seen[0].raw === globalThis.seen[1].raw, globalThis.seen[1].join("|"));
require("./thrower.cjs");
console.log(globalThis.seen.length);
/* Output:
first run
2 false false a|b
2
*/
