const C = globalThis.nothing || class { static m() { return y; } };
let before;
try { before = C.m(); } catch (error) { before = error.name; }
let y = 2;
console.log(before, C.m());
