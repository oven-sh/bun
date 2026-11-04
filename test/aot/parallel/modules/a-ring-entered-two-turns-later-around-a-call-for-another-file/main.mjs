// The call for another file comes between the two for the ring.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const all = [];
all.push(import("./p.mjs"));
await null;
all.push(import("./z.mjs"));
await null;
all.push(import("./q.mjs"));
await Promise.all(all);
console.log("loaded");
/* Output:
z runs
q runs
p runs
loaded
*/
