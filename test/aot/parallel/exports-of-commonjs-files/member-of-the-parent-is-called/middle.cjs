"use strict";
exports.scale = function scale(a, b) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return a + b; };
exports.child = require("./child.cjs");
