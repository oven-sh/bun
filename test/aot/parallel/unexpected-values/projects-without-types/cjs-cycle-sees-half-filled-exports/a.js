exports.early = [1, 2];
exports.step = 1;
var b = require("./b");
exports.late = [3, 4, 5];
exports.count = 2;
exports.step = "two";
exports.double = function (n) {
  return n * 2;
};
exports.whatBSaw = b.seen;
