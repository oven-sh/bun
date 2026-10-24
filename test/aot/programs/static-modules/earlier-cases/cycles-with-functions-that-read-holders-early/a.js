exports.early = "early";
exports.useB = function () { return b.name; };
exports.useConst = function () { return c.name; };
var b = require("./b.js");
const c = require("./c.js");
exports.late = "late";
