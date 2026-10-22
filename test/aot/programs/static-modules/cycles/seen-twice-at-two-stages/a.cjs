exports.one = 1;
const b = require("./b.cjs");
exports.two = 2;
const c = require("./c.cjs");
exports.three = 3;
exports.saw = b.saw + " " + c.saw;
