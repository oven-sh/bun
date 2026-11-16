"use strict";
const bytes = new Uint8Array(11).map((_, i) => i + 1);
function f(v) { let s = ""; for (let i = 0; v.length > i + 2; i += 3) s += v[i] + "," + v[i + 2] + ";"; for (let i = 0; ; i += 3) { if (i + 2 >= v.length) break; s += v[i] + "," + v[i + 1] + ";"; } for (let i = 0; i < 20; i += 3) { if (!(i + 1 < v.length)) continue; s += v[i] + "," + v[i + 1] + "," + v[i + 2] + ";"; } return s; }
console.log(f(bytes));
