"use strict";

Object.defineProperty(exports, "__esModule", { value: true });
exports.default = void 0;
exports.origin = origin;
var Point = /*#__PURE__*/ (function () {
  function Point(x, y) {
    this.x = x;
    this.y = y;
  }
  Point.prototype.sum = function sum() {
    return this.x + this.y;
  };
  return Point;
})();
exports.default = Point;
function origin() {
  return new Point(0, 0);
}
