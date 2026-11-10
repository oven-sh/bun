"use strict";
const lib = require("./lib.cjs");
const n = +(process.argv[2] ?? 7);
let s = 0; for (let i = 0; i < n; i++) s = (lib.add ?? ((a, b) => a - b))(s, i);
console.log(s);
