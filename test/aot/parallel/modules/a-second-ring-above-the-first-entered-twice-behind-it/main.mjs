// p.mjs and q.mjs form a ring of their own above the ring of a.mjs and b.mjs. The lower ring is entered at a.mjs, where the first call entered it. The text of p.mjs is not the first on its way,
// so the call for q.mjs does not wait for its graph: the load of q.mjs ends ahead of that of p.mjs, which waits for it. So p.mjs runs first, and reads what q.mjs has yet to export.
// `bun run` reads the texts on other threads, and which of two texts that wait together comes first is a toss. Where its loader reads them itself
// (BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1) every run prints these lines, and on a quiet machine most runs without that do. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const first = import("./a.mjs");
await null;
const second = import("./p.mjs");
await null;
const third = import("./q.mjs");
const results = await Promise.allSettled([first, second, third]);
console.log(results.map(result => result.status + (result.reason ? " " + result.reason.name : "")).join(" | "));
/* Output:
b runs
a sees B
fulfilled | rejected ReferenceError | rejected ReferenceError
*/
