"use strict";
const plus = (a, b) => a + b, minus = (a, b) => a - b;
function make() { const made = {}; const map = { join: { value: plus } }; map.join = { value: minus }; Object.defineProperties(made, map); return made; }
const turns = +(process.argv[2] ?? 6);
let s = 0;
for (let i = 0; i < turns; i++) s += make().join(5, i);
console.log(s);
