// The second call comes from a process.nextTick() callback and the third from a timer, when the ring has run.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const first = import("./a.mjs");
const fromTick = new Promise(resolve => process.nextTick(() => resolve(import("./b.mjs"))));
const fromTimer = new Promise(resolve => setTimeout(() => resolve(import("./b.mjs")), 0));
const [a, b, again] = await Promise.all([first, fromTick, fromTimer]);
console.log("loaded", b === again, a.a + b.b);
/* Output:
b runs
a sees B
loaded true AB
*/
