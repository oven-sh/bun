"use strict";
// A BigInt and a symbol refuse the conversion: the TypeError is thrown in the first turn, behind what the turn did in front of the call.
const k = JSON.parse('"go"'), never = process.argv.length > 1000 ? "x" : "", hide = new Function("v", "return v;" + never);
let begun = 0;
const T = { go(x, m) { let c = 0; for (let i = 0; i < m; i++) { begun++; c = (c + Math.imul(x, 3) + i) & 1023; } return c; } };
const odd = [5n, Symbol("s"), Object(5n)];
const U = hide(T), say = run => { try { return String(run()); } catch (e) { return e.name; } };
const n = +process.argv[2] || 3;
for (let t = 0; t < n; t++) console.log(T[k](t % 2 + 0.5, 6), odd.map(v => say(() => U[k](v, 3))).join(" "), begun);
