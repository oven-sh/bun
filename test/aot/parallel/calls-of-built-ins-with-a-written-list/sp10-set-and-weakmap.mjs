const s = new Set();
s.add(...["a"]);
const w = new WeakMap(), k = {};
w.set(...[k, 1]);
console.log(s.has(...["a"]), w.get(...[k]));
export {};
