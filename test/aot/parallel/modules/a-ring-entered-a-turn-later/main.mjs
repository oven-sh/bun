// Two calls of import(), a job apart, enter a ring of two modules at its two files. The graph that was asked for first runs first, so the ring is entered at a.mjs, and b.mjs has run when a.mjs reads what it exports.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const first = import("./a.mjs");
await null;
try {
  await Promise.all([first, import("./b.mjs")]);
  console.log("loaded");
} catch (e) {
  console.log("threw " + e.name);
}
/* Output:
b runs
a sees B
loaded
*/
