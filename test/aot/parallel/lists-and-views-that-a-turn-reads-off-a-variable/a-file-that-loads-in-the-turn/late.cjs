const table = JSON.parse("[1.5,2,3.25,4]");
exports.sum = function (turns) { let s = 0; for (let i = 0; i < turns; i++) s += table[i] * 2; return s; };
exports.first = function () { let s = 0; for (let i = 0; i < 1; i++) s += table[i]; return s; };
