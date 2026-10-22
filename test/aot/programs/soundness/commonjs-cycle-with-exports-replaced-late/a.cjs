exports.name = "partial";
const b = require("./b.cjs");
function Real() { return "called"; }
Real.name2 = "x"; Real.fromB = b.sawKeys; Real.late = 1;
module.exports = Real;
Real.late = "late";
