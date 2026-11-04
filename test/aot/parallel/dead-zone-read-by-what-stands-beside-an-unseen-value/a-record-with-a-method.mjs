const o = globalThis.nothing || { m() { return y; } };
let before;
try { before = o.m(); } catch (error) { before = error.name; }
let y = 2;
console.log(before, o.m());
