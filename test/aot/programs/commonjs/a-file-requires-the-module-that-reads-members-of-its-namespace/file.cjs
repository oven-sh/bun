console.log("the file begins");
exports.early = { first: 1 };
exports.call = function () {
  return "called";
};
require("./main.mjs");
exports.late = "late";
console.log("the file ends");
