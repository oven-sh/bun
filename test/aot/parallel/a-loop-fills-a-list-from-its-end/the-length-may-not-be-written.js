'use strict';
function g(a) { let thrown = ""; try { for (let i = 0; i < 20; i++) a[i] = i * 0.5; } catch (e) { thrown = e.constructor.name; } return thrown + a.length + "|" + a.join(); } function f(t) { g([]); const a = [t + 0.5, 2.5]; Object.defineProperty(a, "length", { writable: false }); return g(a); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
