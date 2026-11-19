"use strict";
function label(prefix, box, x) { box.n++; return prefix + (x + box.k); }
const box = { k: 3, n: 0 }, named = label.bind(null, "#", box);
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += named(i).length; return s; }
console.log(drive(+(process.argv[2] ?? 50)), box.n);
