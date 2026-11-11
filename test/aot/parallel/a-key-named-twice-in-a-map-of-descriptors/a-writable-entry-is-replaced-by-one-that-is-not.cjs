"use strict";
const plus = (a, b) => a + b, minus = (a, b) => a - b;
function make(again) { const made = {}; const map = { join: { value: plus, writable: true } }; if (again) map.join = { value: minus }; Object.defineProperties(made, map); return made; }
function store(made) { try { made.join = (a, b) => a * b; return "stored"; } catch (error) { return error.constructor.name; } }
const turns = +(process.argv[2] ?? 4);
let s = "";
for (let i = 0; i < turns; i++) { const made = make(i % 2 === 0); s += made.join(5, 2) + store(made) + made.join(5, 2) + ","; }
console.log(s);
