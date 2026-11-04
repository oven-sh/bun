const o = globalThis.nothing || { get v() { return y; } };
let before;
try { before = o.v; } catch (error) { before = error.name; }
let y = 2;
console.log(before, o.v);
