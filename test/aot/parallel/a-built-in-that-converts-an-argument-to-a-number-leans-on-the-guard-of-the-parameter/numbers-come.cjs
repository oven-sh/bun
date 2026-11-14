"use strict";
// `Math.imul(x, 3)` in a loop converts x to a number: the guard of the function tests x, which is seen to be handed numbers, and the turns convert nothing.
const k = JSON.parse('"go"'), never = process.argv.length > 1000 ? "x" : "", hide = new Function("v", "return v;" + never);
const T = { go(x, m) { let c = 0; for (let i = 0; i < m; i++) c = (c + Math.imul(x, 3) + Math.floor(x) + i) & 1023; return c; } };
const U = hide(T), say = run => { try { return String(run()); } catch (e) { return e.name; } };
const n = +process.argv[2] || 3;
for (let t = 0; t < n; t++) console.log(T[k](t % 2 + 0.5, 50), T[k](t * 1e9 + 7, 50), T[k](-t, 50));
