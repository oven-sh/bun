"use strict";
exports.early = require("./a.cjs");
exports.late = function late() { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return require("./a.cjs"); };
