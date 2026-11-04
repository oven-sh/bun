// As a-ring-one-file-below-the-first-call-entered-a-turn-later, one file deeper: q.mjs has asked for p.mjs before the first graph comes there, so the second graph is loaded first, and the ring is entered at q.mjs.
// `bun run` reads the texts on other threads, and which of two texts that wait together comes first is a toss. Where its loader reads them itself
// (BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1) every run prints these lines, and on a quiet machine most runs without that do. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const all = [];
all.push(import("./r.mjs"));
await null;
all.push(import("./q.mjs"));
await Promise.all(all);
console.log("loaded");
/* Output:
p runs
q runs
r1 runs
r runs
loaded
*/
