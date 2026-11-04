const C = globalThis.nothing || class { v = y; };
let before;
try { before = new C().v; } catch (error) { before = error.name; }
let y = 2;
console.log(before, new C().v);
