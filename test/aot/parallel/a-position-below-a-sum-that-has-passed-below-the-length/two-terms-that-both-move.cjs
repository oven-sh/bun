"use strict";
const bytes = new Uint8Array(11).map((_, i) => i + 1);
function f(v) { let s = ""; for (let i = 0, j = 1; i + j < v.length; i += 2, j += 1) s += v[i] + "," + v[j] + "," + v[i + j] + "," + v[i + j + 1] + ";"; return s; }
console.log(f(bytes));
