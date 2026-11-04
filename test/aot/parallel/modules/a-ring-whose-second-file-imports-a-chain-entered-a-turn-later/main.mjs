// The chain hangs below q.mjs, which the second call names. p.mjs has asked for q.mjs when its text comes, so what q.mjs asks for belongs to the first graph.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const all = [];
all.push(import("./p.mjs"));
await null;
all.push(import("./q.mjs"));
await Promise.all(all);
console.log("loaded");
/* Output:
y3 runs
y2 runs
y1 runs
q runs
p runs
loaded
*/
