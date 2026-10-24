var Shape = require("./shape.cjs");

function Triangle(edge) {
  if (!(this instanceof Triangle)) return new Triangle(edge);
  Shape.call(this, "triangle", 3);
  this.edge = edge;
}

Triangle.prototype = Object.create(Shape.prototype, {
  constructor: { value: Triangle, writable: true, configurable: true },
});

Triangle.prototype.area = function () {
  return (this.edge * this.edge) / 2;
};

module.exports = Triangle;
