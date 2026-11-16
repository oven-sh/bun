"use strict";
const lib_1 = require("./lib.cjs");
const text = new Function(JSON.parse("\"return 1\""));
function turns(n) { let s = 0; for (let i = 0; i < n; i++) { if (i === 25) lib_1.swap(); s = lib_1.default.times(s, 3) + lib_1.default.plus(i, s) | 0; } return s; }
console.log(turns(40), text(), lib_1.other.plus(1, 2));
