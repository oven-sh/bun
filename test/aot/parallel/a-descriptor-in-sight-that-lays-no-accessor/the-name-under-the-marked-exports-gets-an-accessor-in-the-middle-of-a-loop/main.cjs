"use strict";
const u_1 = require("./u.cjs");
const text = new Function("held", JSON.parse("\"Object.defineProperty(held, \\\"default\\\", { get() { return { ua(a, b) { return 1; }, ub(a, b) { return 2; } }; } });\""));
function e(n) { let s = 0; for (let i = 0; i < n; i++) { if (i === 20) text(u_1); s = u_1.default.ub(s, 3) + u_1.default.ua(i, s) | 0; } return s; }
console.log(e(40));
