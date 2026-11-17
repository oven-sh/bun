"use strict";
const map = { size: { value: 1, enumerable: true } };
const first = Object.create(null, map);
map.size.value = 2;
map.more = { value: 3, enumerable: true };
const second = Object.create(null, map);
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += first.size + second.size + second.more; return s; }
console.log(drive(+(process.argv[2] ?? 50)), Object.keys(first).join(), Object.keys(second).join());
