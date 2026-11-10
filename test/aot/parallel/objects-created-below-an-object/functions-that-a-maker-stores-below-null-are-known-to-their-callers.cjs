// STATISTIC: FlowAppendedFields <= 0
// STATISTIC: FieldsOutOfLine <= 0
// STATISTIC: CallsInlined >= 1
"use strict";
function add(out, a, b) { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; out[2] = a[2] + b[2]; return out; }
function scale(out, a, s) { out[0] = a[0] * s; out[1] = a[1] * s; out[2] = a[2] * s; return out; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
const N = Object.create(null); N.add = add; N.scale = scale; N.dot = dot;
const o = new Float64Array(3), p = new Float64Array([1.5, 2.5, 3.5]), q = new Float64Array([0.5, 0.25, 4]);
function f(t) { p[0] = t & 7; let s = 0; for (let i = 0; i < 100; i++) { N.add(o, p, q); N.scale(o, o, 0.5); s += N.dot(o, p); } return s; }
let sum = 0; for (let t = 0; t < 50; t++) { if (t === 40) N.dot = (a, b) => a[0] - b[0]; if (t === 45) delete N.scale, N.scale = (out) => out; sum = (sum + f(t)) % 1000003; }
console.log(Math.floor(sum));
