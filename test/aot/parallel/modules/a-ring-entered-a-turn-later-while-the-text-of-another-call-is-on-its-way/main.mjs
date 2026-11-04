// The two calls for the ring come behind a call for another file. Only a text that is asked for while none is on its way comes ahead of the later ones: here nobody waits, and the loader's own timing decides.
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
z runs
p runs
q runs
loaded
*/
