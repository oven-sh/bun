const first = require("./first.cjs");

first.uses("before anything is exported,");
exports.n = 7;
exports.a = [5, 6];
first.uses("halfway,");
exports.s = "abc";
exports.f = x => x + 1;
exports.o = { x: 1, y: 2 };
first.uses("at the end of the second module,");
module.exports = { ...exports, n: "7", replaced: true };
first.uses("after the exports object was replaced,");
