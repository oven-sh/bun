"use strict";
const lib = require("./lib.cjs");
const n = +(process.argv[2] ?? 7);
let s = 0; for (let i = 0; i < n; i++) s = (0, lib.add)(s, i);
console.log(s);
require("./add.cjs").add = (a, b) => a + b + 1;
console.log(lib.add(1, 1));
