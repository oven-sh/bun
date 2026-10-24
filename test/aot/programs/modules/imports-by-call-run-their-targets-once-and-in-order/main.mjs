// Imports by call run their targets once and in order.
console.log("1");
const p = import("./a.mjs");
console.log("2");
const a = await p;
console.log("3", a.v, (await import("./a.mjs")) === a);
const c = await import("./c.cjs");
console.log(Object.keys(c).sort().join(), c.default.x, c.x);
