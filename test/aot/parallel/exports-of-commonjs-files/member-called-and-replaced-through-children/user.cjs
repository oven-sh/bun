"use strict";
const tools = require("./tools.cjs");
exports.use = function use(n) { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return tools.sum(n, 1); };
