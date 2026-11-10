"use strict";
function add(out, a, b) { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; return out; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
function minus(a, b) { return a[0] * b[0] - a[1] * b[1]; }
const N = { add: undefined, dot: undefined }; N.add = add; N.dot = dot; Object.defineProperty(N, "dot", { value: dot });
const o = new Float64Array(2), p = new Float64Array([1.5, 2.5]), q = new Float64Array([0.5, 0.25]);
// `N.add` stores into `o`; the test whether the slot of `dot` is filled stands behind that store. It reads what no turn writes: it is asked in front of the loop, and no arm of the turn runs other code.
function f(t) { p[0] = t & 7; let s = 0; for (let i = 0; i < 100; i++) { N.add(o, p, q); s += N.dot(o, p); } return s; }
const n = +process.argv[2] || 12, at = +process.argv[3] || 5; let sum = 0;
for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003;
console.log(sum);
