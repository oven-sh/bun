const C = globalThis.nothing || class { static get v() { return y; } };
let before;
try { before = C.v; } catch (error) { before = error.name; }
let y = 2;
console.log(before, C.v);
