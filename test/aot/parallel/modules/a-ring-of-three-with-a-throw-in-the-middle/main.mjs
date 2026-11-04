// The ring is entered at a.mjs, so c.mjs runs and then b.mjs, which throws. All three have failed with that error, also c.mjs, which ran to its end: every call for one of them is rejected with it, now and later.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const first = import("./a.mjs");
await null;
const results = await Promise.allSettled([first, import("./c.mjs"), import("./b.mjs")]);
console.log(results.map(result => result.status + " " + (result.reason?.message ?? "")).join(" | "));
console.log(results[0].reason === results[1].reason, results[1].reason === results[2].reason);
for (const again of [() => import("./c.mjs"), () => import("./b.mjs"), () => import("./a.mjs")]) {
  try {
    await again();
    console.log("loaded");
  } catch (e) {
    console.log("again " + e.message, e === results[0].reason);
  }
}
/* Output:
c runs
b runs
rejected b fails | rejected b fails | rejected b fails
true true
again b fails true
again b fails true
again b fails true
*/
