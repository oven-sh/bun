'use strict';
// The throw leaves the loop and the function: what the turns have stored into the view is there, and the message names the member as it is written.
function add(out, a, b) { out[0] = a[0] + b[0]; out[1] = a[1] + b[1]; return out; }
const N = {}; N.add = add; if (process.argv.length > 99) N.gone = add;
const o = new Float64Array(2), p = new Float64Array([1.5, 2.5]), q = new Float64Array([0.5, 0.25]);
function f(t, last) { for (let i = 0; i < 10; i++) { p[i & 1] = i + t; if (i === last) N.gone(o, p, q); else N.add(o, p, q); } return o[0] + o[1]; }
const n = +process.argv[2] || 4; for (let t = 0; t < n; t++) { let said; try { said = String(f(t, 7 + t)); } catch (e) { said = e.name + ": " + e.message; } console.log(said, o[0], o[1], p[0], p[1]); }
