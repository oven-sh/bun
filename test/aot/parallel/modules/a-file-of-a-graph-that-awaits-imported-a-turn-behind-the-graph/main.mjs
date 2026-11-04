// As a-file-of-a-graph-imported-a-turn-behind-the-graph, where the root of the graph awaits.
const order = [];
const first = import("./a.mjs");
first.then(() => order.push("first"));
await null;
const second = import("./c.mjs");
second.then(() => order.push("second"));
await Promise.all([first, second]);
console.log(order.join());
