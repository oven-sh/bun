console.log("a starts");
exports.early = "early";
const b = require("./b.cjs");
exports.late = "late";
exports.lateFunction = function () {
  return "called";
};
exports.fromB = b.earlyOfA + "," + b.lateOfA;
console.log("a ends");
