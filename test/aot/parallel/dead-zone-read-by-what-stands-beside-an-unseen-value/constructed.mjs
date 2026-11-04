const F = globalThis.nothing || function () { this.v = y; };
let before;
try { before = new F().v; } catch (error) { before = error.name; }
let y = 2;
console.log(before, new F().v);
