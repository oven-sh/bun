// As a-ring-entered-a-turn-later, with the calls the other way round: nothing in the build says where a ring is entered.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const first = import("./b.mjs");
await null;
try {
  await Promise.all([first, import("./a.mjs")]);
  console.log("loaded");
} catch (e) {
  console.log("threw " + e.name);
}
/* Output:
a runs
b sees A
loaded
*/
