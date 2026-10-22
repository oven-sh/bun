console.log("b starts");
const a = require("./a.cjs");
exports.earlyOfA = a.early;
exports.lateOfA = a.late;
exports.typeOfLateFunction = typeof a.lateFunction;
exports.readLateOfA = () => a.late;
exports.callLateFunctionOfA = () => a.lateFunction();
console.log("b ends");
