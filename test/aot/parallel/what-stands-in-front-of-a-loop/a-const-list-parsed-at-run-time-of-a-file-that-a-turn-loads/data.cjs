"use strict";
const table = JSON.parse("[1.5, 2.5]");
exports.total = function total(turns) { let sum = 0; for (let t = 0; t < turns; t++) sum += table[t]; return sum; };
