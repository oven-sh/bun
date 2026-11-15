exports.sum = function (turns) { let s = 0; for (let i = 0; i < turns; i++) s += table[i] * 2; return s; };
exports.early = require("./second-of-a-cycle.cjs").early;
const table = JSON.parse("[1.5,2,3.25,4]");
