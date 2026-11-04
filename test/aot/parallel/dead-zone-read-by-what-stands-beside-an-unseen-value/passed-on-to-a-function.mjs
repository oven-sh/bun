const f = globalThis.nothing || (() => y);
function run(g) { return g(); }
let before;
try { before = run(f); } catch (error) { before = error.name; }
let y = 2;
console.log(before, run(f));
