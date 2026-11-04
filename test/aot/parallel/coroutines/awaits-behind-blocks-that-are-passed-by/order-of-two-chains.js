async function load(k) { return k > 100; }
const order = [];
async function first(k, slow) { order.push("first in"); const yes = await (slow ? load(k) : (k === 1 || k === 4 || k === 9)); order.push("first out " + yes); }
async function second() { order.push("second in"); await null; order.push("second out"); }
first(4, false); second();
await null; await null; await null;
console.log(order.join(" | "));
