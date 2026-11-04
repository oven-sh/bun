const list = globalThis.nothing || [() => y];
let before;
try { before = list[0](); } catch (error) { before = error.name; }
let y = 2;
console.log(before, list[0]());
