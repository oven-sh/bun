"use strict";
const join = require("./join.cjs");
exports.run = function run(i) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return join("t" + i, { toString() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return "o"; } }); };
