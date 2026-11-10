'use strict';
function g(a) { let thrown = ""; try { for (let i = 0; i < 20; i++) a[i] = i * 0.5; } catch (e) { thrown = e.constructor.name; } return thrown + a.length + "|" + a.join(); } function f(t) { g([]); g([0.5]); return g(Object.freeze([t + 0.5, 1.5])) + "/" + g(Object.preventExtensions([t + 0.5])) + "/" + g(Object.seal([t + 0.5])); }
const n = +process.argv[2] || 3; let all = ""; for (let t = 0; t < n; t++) all = f(t); console.log(all);
