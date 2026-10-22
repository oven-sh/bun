var util = require("util");
var Shape = require("./shape.cjs");

function Square(edge) {
  Shape.call(this, "square", 4);
  this.edge = edge;
}

util.inherits(Square, Shape);

Square.prototype.area = function () {
  return this.edge * this.edge;
};

exports.Square = Square;
exports.make = function (edge) {
  return new Square(edge);
};
