"use strict";
const plus = (a, b) => a + b, minus = (a, b) => a - b;
function swap(map) { map.join = { value: minus }; }
function make(again) { const map = { join: { value: plus } }; if (again) swap(map); return Object.defineProperties({}, map); }
const turns = +(process.argv[2] ?? 6);
let s = "";
for (let i = 0; i < turns; i++) s += make(i % 2 === 0).join(5, 2) + ",";
console.log(s);
