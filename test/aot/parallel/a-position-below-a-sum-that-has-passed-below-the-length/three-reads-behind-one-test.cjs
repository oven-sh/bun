"use strict";
const bytes = new Uint8Array(11).map((_, i) => i + 1);
function f(v) { let s = 0; for (let i = 0; i + 2 < v.length; i += 3) s = (s * 31 + v[i] + v[i + 1] * 2 + v[i + 2] * 3) | 0; return s; }
console.log(f(bytes), f(new Uint8Array(0)), f(new Uint8Array(2)), f(new Uint8Array(3).fill(9)));
