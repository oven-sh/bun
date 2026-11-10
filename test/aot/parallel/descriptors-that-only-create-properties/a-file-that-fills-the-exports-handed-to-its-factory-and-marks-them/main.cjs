"use strict";
const shelf = require("./shelf.cjs");
function turns(n) { let s = 0; for (let i = 0; i < n; i++) s = shelf.times(s, 3) + shelf.plus(i, s) | 0; return s; }
console.log(turns(Number(process.argv[2] || 40)), shelf.__esModule, Object.keys(shelf).join());
