"use strict";
function join(a, b) { return a + b; }
const kept = [];
const names = {};
function fill() { let map; Object.defineProperties(names, (map = { join: { value: join } })); kept.push(map); }
fill();
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s = names.join(s, i); return s; }
const found = JSON.parse('"join"');
console.log(drive(+(process.argv[2] ?? 50)), kept[0][found].value("a", "b"), kept[0][found].value([1], 2));
