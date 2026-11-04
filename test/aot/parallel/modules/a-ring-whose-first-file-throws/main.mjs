// As a-ring-run-in-order-by-an-awaited-import, and the file of the ring that runs first throws: a.mjs, where the ring was entered, never runs.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
try {
  await Promise.all([import("./a.mjs"), import("./b.mjs")]);
  console.log("loaded");
} catch (e) {
  console.log("threw " + e.message);
}
/* Output:
b starts
c starts
threw c fails
*/
