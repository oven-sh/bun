// Two calls of import(), a job apart, enter a ring of two modules at its two files. The ring is entered where the first call enters it.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const first = import("./a.mjs");
await null;
await Promise.all([first, import("./b.mjs")]);
console.log("loaded");
/* Output:
b runs
a runs
loaded
*/
