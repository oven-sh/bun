var Shape = require("./shape.cjs");

function Circle(edge) {
  Shape.call(this, "circle", 1);
  this.edge = edge;
}

Circle.prototype.area = function () {
  return this.edge * this.edge * 3;
};

module.exports = Circle;
