// The first call names a file that imports the ring, the second a file of the ring. Both graphs end with the text of p.mjs, which the first has asked for: the ring is entered at p.mjs.
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
q runs
p runs
r runs
loaded
*/
