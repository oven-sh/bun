"use strict";
function join(a, b) { return a + b; }
const names = {};
const map = { join: { value: join }, size: { value: 3 } };
Object.defineProperties(names, map);
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s = names.join(s, i) + names.size; return s; }
console.log(drive(+(process.argv[2] ?? 50)), map.join.value("a", "b"), map.size.value, Object.keys(map).join());
