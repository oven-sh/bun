"use strict";
const lib = require("./lib.cjs");
const n = +(process.argv[2] ?? 7);
let s = 0; for (let i = 0; i < n; i++) s = (0, lib.add)(s, i);
console.log(s, typeof lib.more);
require("./add.cjs").more = 1;
console.log(typeof lib.more);
