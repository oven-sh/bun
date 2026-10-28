"use strict";
exports.label = undefined;
exports.first = 1;
exports.second = "two";
exports.third = [3];
exports.read = function read() {
  return [exports.label, exports.first, exports.second, String(exports.third), exports.late, exports.added].join("|");
};
exports.refill = function refill() {
  exports.first = "first again";
  exports.second = "second again";
  exports.third = "third again";
  return "stored";
};
exports.addLate = function addLate() {
  exports.late = "late";
  return "added";
};
