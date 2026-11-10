"use strict";
const u_1 = require("./lib.cjs");
const text = new Function(JSON.parse("\"return 1\""));
const turns = Number(process.argv[2] || 40);
function e(n) { let s = 0; for (let i = 0; i < n; i++) { s = u_1.default.scale(s, 3) + u_1.default.shift(i, s) | 0; } return s; }
console.log("SAID", e(turns), text());
