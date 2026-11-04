// The second call for the ring waits for the graph of the first. A call for a file that shares nothing with them waits for nobody: that file has nothing to load below it, and runs ahead of the ring.
// `bun run` reads the texts on other threads: not every run of it prints these lines, but more print them than any others. So they are stored.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=0
const order = [];
const first = import("./a.mjs");
first.then(() => order.push("first"));
await null;
const second = import("./b.mjs");
second.then(() => order.push("second"));
const beside = import("./beside.mjs");
beside.then(() => order.push("beside"));
await Promise.all([first, second, beside]);
console.log(order.join());
/* Output:
beside runs
b runs
a runs
beside,first,second
*/
