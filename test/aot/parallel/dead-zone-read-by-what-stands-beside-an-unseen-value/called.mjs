const f = globalThis.nothing || (() => y);
let before;
try { before = f(); } catch (error) { before = error.name; }
let y = 2;
console.log(before, f());
