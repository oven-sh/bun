function choose(given) { return given || (() => y); }
const f = choose(globalThis.nothing);
let before;
try { before = f(); } catch (error) { before = error.name; }
let y = 2;
console.log(before, f());
