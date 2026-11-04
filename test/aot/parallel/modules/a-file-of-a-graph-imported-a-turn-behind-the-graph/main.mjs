// No ring: what two graphs share runs the same whichever of them comes to it first. The call for the deepest file waits for nobody, and settles ahead of the call for the graph.
// Env: BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1
// `bun <file>` as users run it prints `first,second` once in 120 runs on a busy machine and `second,first` else (11-03): which text its transpiler's threads finish first decides. On one thread: 120 of 120 the same.
const order = [];
const first = import("./a.mjs");
first.then(() => order.push("first"));
await null;
const second = import("./c.mjs");
second.then(() => order.push("second"));
await Promise.all([first, second]);
console.log(order.join());
