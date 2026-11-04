// Neither call names a file of the ring: p.mjs imports one of its files and q.mjs the other. Each graph asks for its own file of the ring, and the text that q.mjs asked for comes last:
// the graph of q.mjs hears of it first, and the ring is entered at b.mjs. Nobody waits for anybody.
// `bun run` reads the texts on other threads, and which of two texts that wait together comes first is a toss. Where its loader reads them itself
// (BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1) every run prints these lines, and on a quiet machine most runs without that do. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const all = [];
all.push(import("./p.mjs"));
await null;
all.push(import("./q.mjs"));
await Promise.all(all);
console.log("loaded");
/* Output:
a runs
b runs
q runs
p runs
loaded
*/
