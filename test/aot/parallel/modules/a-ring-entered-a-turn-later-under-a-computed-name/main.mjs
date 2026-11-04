// As a-ring-entered-a-turn-later, where the second call finds its file by a name that the run computes.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const name = process.argv.length < 99 ? "b" : "a";
const first = import("./a.mjs");
await null;
try {
  await Promise.all([first, import("./" + name + ".mjs")]);
  console.log("loaded");
} catch (e) {
  console.log("threw " + e.name);
}
/* Output:
b runs
a sees B
loaded
*/
