'use strict';
// STATISTIC: CallsOfWhatIsNoObjectThatRunNoCode >= 1
// `N.add` lies in a slot that may be empty. The arm where it is undefined throws and runs no code: the turn stays quiet, and what the turn reads of the views stands in front of the loop.
function add(out, a, b) { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; return out; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1]; }
const N = {}; N.add = add; N.dot = dot;
const o = new Float64Array(2), p = new Float64Array([1.5, 2.5]), q = new Float64Array([0.5, 0.25]);
function f(t) { p[0] = t & 7; let s = 0; for (let i = 0; i < 100; i++) { N.add(o, p, q); s += N.dot(o, p); } return s; }
const n = +process.argv[2] || 50; let sum = 0; for (let t = 0; t < n; t++) sum = (sum + f(t)) % 1000003; console.log(sum);
