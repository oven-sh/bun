"use strict";
function blend(a, b, c, x) { return a * x * x + b * x + c; }
const curve = blend.bind(null, 2, 0.5, -3);
function drive(turns) { let s = 0; for (let i = 0; i < turns; i++) s += curve(i); return s; }
console.log(drive(+(process.argv[2] ?? 50)));
