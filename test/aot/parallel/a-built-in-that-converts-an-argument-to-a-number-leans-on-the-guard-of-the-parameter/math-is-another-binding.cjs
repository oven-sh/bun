"use strict";
// The rule goes by the binding: a Math that the file has made itself is called as any object is.
const k = JSON.parse('"go"'), never = process.argv.length > 1000 ? "x" : "", hide = new Function("v", "return v;" + never);
const own = (function () { const Math = { imul(a, b) { return String(a) + b; } }; return { go(x, m) { let c = ""; for (let i = 0; i < m; i++) c += Math.imul(x, 3); return c; } }; })();
const T = { go(x, m) { let c = 0; for (let i = 0; i < m; i++) c = (c + Math.imul(x, 3) + i) & 1023; return c; } };
const U = hide(T), say = run => { try { return String(run()); } catch (e) { return e.name; } };
const n = +process.argv[2] || 3;
for (let t = 0; t < n; t++) console.log(T[k](t % 2 + 0.5, 6), own[k](t % 2 + 0.5, 3), hide(own)[k]("z", 2));
