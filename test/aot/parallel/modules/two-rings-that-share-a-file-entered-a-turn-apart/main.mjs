// s.mjs stands in a ring with a.mjs and in one with x.mjs. Three calls, each a job behind the one before it, name all three: everything runs from a.mjs, where the first call entered.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const first = import("./a.mjs");
await null;
const second = import("./x.mjs");
await null;
const third = import("./s.mjs");
await Promise.all([first, second, third]);
console.log("loaded");
/* Output:
x runs
s runs
a runs
loaded
*/
