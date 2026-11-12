"use strict";
// What fails the guard is converted as the language says: a text by its digits, undefined to NaN, null to 0, true to 1.
const k = JSON.parse('"go"'), never = process.argv.length > 1000 ? "x" : "", hide = new Function("v", "return v;" + never);
const T = { go(x, m) { let c = 0; for (let i = 0; i < m; i++) c = c + Math.floor(x) + Math.abs(x); return c; } };
const odd = ["7.5", "-3", "x", "", undefined, null, true, false, [], [4.5], {}];
const U = hide(T), say = run => { try { return String(run()); } catch (e) { return e.name; } };
const n = +process.argv[2] || 3;
for (let t = 0; t < n; t++) console.log(T[k](t % 2 + 0.5, 6), odd.map(v => say(() => U[k](v, 3))).join(" "));
