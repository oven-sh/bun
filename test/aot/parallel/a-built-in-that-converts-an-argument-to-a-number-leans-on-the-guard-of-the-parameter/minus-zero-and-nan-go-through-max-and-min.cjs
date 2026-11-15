"use strict";
// Behind the guard Math.max and Math.min keep -0 apart from 0 and hand NaN on.
const k = JSON.parse('"go"'), never = process.argv.length > 1000 ? "x" : "", hide = new Function("v", "return v;" + never);
const T = { go(x, m) { let out = ""; for (let i = 0; i < m; i++) out += (Object.is(Math.max(x, -0), -0) ? "a" : "b") + (Object.is(Math.min(x, 0), -0) ? "c" : "d") + (Math.max(x, i) !== Math.max(x, i) ? "e" : "f"); return out; } };
const U = hide(T), say = run => { try { return String(run()); } catch (e) { return e.name; } };
const n = +process.argv[2] || 3;
for (let t = 0; t < n; t++) console.log(T[k](t % 2 + 0.5, 2), T[k](-0, 2), T[k](0, 2), T[k](NaN, 2), T[k](-Infinity, 2), U[k]("-0", 2));
