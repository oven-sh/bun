"use strict";
const bytes = new Uint8Array(11).map((_, i) => i + 1);
function f(v, from, step) { let s = ""; for (let i = from; i + 2 < v.length; i += step) s += v[i] + "," + v[i + 1] + "," + v[i + 2] + ";"; return s; }
console.log(f(bytes, 0.0, 3.0), f(bytes, 6 / 2, 9 / 3), f(bytes, 1e0, 4), f(bytes, -0, 3), f(bytes, 4294967296, 1), f(bytes, 9007199254740991, 1));
