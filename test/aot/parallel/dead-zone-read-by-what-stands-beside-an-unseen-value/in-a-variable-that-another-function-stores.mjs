let f = globalThis.nothing;
function set() { f = f || (() => y); }
set();
let before;
try { before = f(); } catch (error) { before = error.name; }
let y = 2;
console.log(before, f());
