"use strict";
const u_1 = require("./u.cjs");
const text = new Function(JSON.parse("\"return 1\""));
function e(n) { let s = 0; for (let i = 0; i < n; i++) s = u_1.default.ub(s, 3) + u_1.default.ua(i, s) | 0; return s; }
console.log(e(40), text());
