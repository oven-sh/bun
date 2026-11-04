// z.mjs and p.mjs import one file, and the call for z.mjs comes first: the text of p.mjs is not the first on its way, and nobody waits for its graph.
// `bun run` reads the texts on other threads, and which of two texts that wait together comes first is a toss. Where its loader reads them itself
// (BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1) every run prints these lines, and on a quiet machine most runs without that do. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const all = [];
all.push(import("./z.mjs"));
await null;
all.push(import("./p.mjs"));
await null;
all.push(import("./q.mjs"));
await Promise.all(all);
console.log("loaded");
/* Output:
y runs
z runs
p runs
q runs
loaded
*/
