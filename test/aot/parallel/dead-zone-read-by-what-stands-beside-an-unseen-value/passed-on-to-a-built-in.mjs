const f = globalThis.nothing || (() => y);
let before;
try { before = [0].map(f)[0]; } catch (error) { before = error.name; }
let y = 2;
console.log(before, [0].map(f)[0]);
