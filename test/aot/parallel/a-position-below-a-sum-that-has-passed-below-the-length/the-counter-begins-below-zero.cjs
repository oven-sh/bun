"use strict";
const bytes = new Uint8Array(11).map((_, i) => i + 1);
function f(v, from) { let s = ""; for (let i = from; i + 2 < v.length; i += 3) s += v[i] + "," + v[i + 1] + "," + v[i + 2] + ";"; return s; }
console.log(f(bytes, -4), f(bytes, -1), f(bytes, 0));
