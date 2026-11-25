// STATISTIC: PassedHolesLeaveIterations >= 4
// A loop too long to be written out hands elements of lists of fractions to small functions that only calculate with what they are handed: a place that was left out leaves the turn, so what is handed on is a number.
'use strict';
function blended(a, b, c, k) { const l = 2 - k; return a * l + b * k * l - c * k / 4 + a * b * 0.125; }
function offset(low, high, at) { return (at - low) / (high - low + 1) * 100; }
function leaning(a, b) { return a > b ? a - b * 0.5 : b * 2 - a; }
function woven(p, q, r, s, out) { for (let i = 0; i < out.length; i++) { const v = blended(p[i], q[i], 0.5, 0.25), w = offset(r[i], s[i], v), u = leaning(v, w); out[i] = u + offset(v, u, 3) * 1e-2 - blended(w, u, v, 0.125) * 1e-3 + leaning(w, 2) * 0.5 - blended(u, w, 1, 0.75) * 1e-4 + offset(u, w, v) * 1e-5 + leaning(u * 0.5, w) - blended(v, v, u, 0.5) * 1e-3; } return out; }
function drawn(xs, ys, n) { let sum = 0; for (let i = 0; i < n; i++) { const t = (i % 16) / 16; const x = blended(xs[i], xs[i + 1], xs[i + 2], t), y = blended(ys[i], ys[i + 1], ys[i + 2], t); sum += leaning(x, y) * 0.5 + offset(x, y, t); } return sum; }
const parts = (n, by) => { const list = []; for (let i = 0; i < n; i++) list.push(i / 3 - by); return list; };
const p = parts(64, 1), q = parts(64, 2), r = parts(64, 0.5), z = parts(64, 4), out = new Float64Array(60), round = v => Math.round(v * 1e6) / 1e6;
let sum = 0; for (let k = 0; k < 200; k++) { woven(p, q, r, z, out); sum += drawn(p, q, 50) + out[k % 60]; }
console.log(round(sum), Array.from(out.slice(0, 8), round).join(), Array.from(woven(q, p, z, r, out).slice(-4), round).join());
delete q[60]; delete p[7]; delete r[0]; delete z[33];
for (let k = 0; k < 3; k++) { woven(p, q, r, z, out); console.log(round(drawn(p, q, 50)), Array.from(out, (v, i) => (v !== v ? i : '')).filter(String).join(), round(drawn(r, z, 62)), round(drawn(z, p, 6))); }
q[60] = 0.5; p[7] = 1; console.log(round(drawn(p, q, 50)), Array.from(woven(p, q, r, z, out), v => (v !== v ? 'n' : '.')).join('')); console.log(round(drawn(p, q, 63)), round(drawn([], q, 2)), drawn(p, q, 0));
