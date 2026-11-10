'use strict';
// The throw leaves the loop for a handler of the same function, which reads what the turns have counted.
function add(out, a, b) { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; return out; }
const N = {}; N.add = add; if (process.argv.length > 99) N.gone = add;
const o = new Float64Array(2), p = new Float64Array([1.5, 2.5]), q = new Float64Array([0.5, 0.25]);
function f(t, last) { let i = 0, s = 0; try { for (; i < 10; i++) { p[i & 1] = i + t; s += p[0]; if (i === last) N.gone(o, p, q); else N.add(o, p, q); } } catch (e) { return e.name + " at " + i + " with " + s + " and " + o[0]; } return "through with " + s; }
const n = +process.argv[2] || 5; for (let t = 0; t < n; t++) console.log(f(t, 6 + t));
