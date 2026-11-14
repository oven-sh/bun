// Math.min, Math.max and Math.abs of what converts to a number, stored into tables, fields and views.
"use strict";
const show = v => Object.is(v, -0) ? "-0" : typeof v === "bigint" ? v + "n" : String(v);
const own = a => a.length + ":" + Array.from(a, show).join();
let log = "";
const values = new Map(); [0, -0, 1, -7, NaN, Infinity, -Infinity, 2 ** 31, -(2 ** 31), 2 ** 53, 2 ** 60, undefined, null, true, false, 0.5, "3", "x", { valueOf() { log += "v"; return 2.5; } }, 4n, [5.5]].forEach((v, k) => values.set(k, v));
function fill(a, b, n) { const t = new Array(n + 1), u = new Float64Array(n + 1), v = new Int32Array(n + 1), o = { least: 9, most: -9 }; t[0] = 0; for (let i = 1; i <= n; i++) { t[i] = Math.max(Math.min(t[i - 1] + 1, a), Math.abs(b)); u[i] = Math.min(a, i); v[i] = Math.max(b, -i); o.least = Math.min(o.least, a); o.most = Math.max(o.most, b, i); } return [own(t), own(u), own(v), show(o.least), show(o.most), Object.is(Math.min(a, 0), -0)].join(" "); }
function table(a, n) { const t = new Array(n + 1); t[0] = 0; for (let i = 1; i <= n; i++) t[i] = Math.min(t[i - 1] + 1, a); return own(t); }
for (let round = 0; round < 2; round++) for (const [k, a] of values) { let r; for (const b of values.values()) { try { r = fill(a, b, 4); } catch (e) { r = e.constructor.name; } console.log(k, r, log); log = ""; } try { r = table(a, 5); } catch (e) { r = e.constructor.name; } console.log(k, r, log); log = ""; }
console.log(show(Math.min()), show(Math.max()), show(Math.min(...[3, 0.5])), show(Math.max.apply(null, [1, 2.5])), show(Math.abs()));
