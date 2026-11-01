function Point(x, y) {
  this.x = String(x);
  this.y = String(y);
}
Point.prototype.sum = function () {
  return this.x + this.y;
};
exports.Point = Point;
exports.build = "the CommonJS build";
exports.isPoint = function (value) {
  return value instanceof Point;
};
