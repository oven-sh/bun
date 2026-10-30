var Vector = require("vector");
exports.Vector = Vector;
exports.make = function (x, y) {
  return new Vector(x, y);
};
exports.add = function (a, b) {
  return a.plus(b);
};
exports.measure = function (vector) {
  return vector.length2();
};
