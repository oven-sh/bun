// `bun run` hears of the text that another thread reads after its event loop has polled, so the immediates that wait run first. Under load the thread may be the faster one: the lines
// are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
setImmediate(() => console.log("immediate"));
queueMicrotask(() => console.log("job"));
const imported = await import("./imported.mjs");
console.log("after import", imported.v);
/* Output:
job
immediate
imported
job of imported
after import 1
immediate of imported
*/
