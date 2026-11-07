"use strict";
// What fails the guard runs as written: valueOf is called once a turn, in its place among what the turn does.
const k = JSON.parse('"go"'), never = process.argv.length > 1000 ? "x" : "", hide = new Function("v", "return v;" + never);
let calls = 0; const seen = [];
const T = { go(x, m) { let c = 0; for (let i = 0; i < m; i++) { seen.push(calls); c = (c + Math.imul(x, 3) + i) & 1023; } return c; } };
const odd = { valueOf() { calls++; return calls + 0.5; } };
const U = hide(T), say = run => { try { return String(run()); } catch (e) { return e.name; } };
const n = +process.argv[2] || 3;
for (let t = 0; t < n; t++) console.log(T[k](t % 2 + 0.5, 6), say(() => U[k](odd, 4)), calls, seen.join());
