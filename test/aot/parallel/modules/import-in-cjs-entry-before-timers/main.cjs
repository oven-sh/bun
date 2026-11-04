// What the body of the entry point imports runs ahead of its timers, as in Node.js and `bun build --compile`. `bun run` reads the texts on threads: there it is a race.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
setTimeout(() => console.log("a timer"), 0);
setImmediate(() => console.log("an immediate"));
import("./a.mjs").then(() => console.log("a is in"));
process.nextTick(() => console.log("a tick"));
Promise.resolve().then(() => console.log("a job"));
console.log("the body ends");
/* Output:
the body ends
a tick
a job
b runs
a runs
a is in
an immediate
a timer
*/
