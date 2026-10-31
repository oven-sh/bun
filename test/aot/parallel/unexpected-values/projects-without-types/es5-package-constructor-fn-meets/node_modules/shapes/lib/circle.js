var inherits = require("./inherits");
var Shape = require("./shape");

function Circle(radius) {
  Shape.call(this, "circle");
  this.radius = radius;
}
inherits(Circle, Shape);
Circle.prototype.area = function () {
  return 3 * this.radius * this.radius;
};
Circle.prototype.grow = function (by) {
  this.radius += by;
  return this;
};
module.exports = Circle;
