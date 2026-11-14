var Shape = require("./shape");

function Square(side) {
  Shape.call(this, "square");
  this.side = side;
}
Square.prototype = new Shape("prototype of squares");
Square.prototype.constructor = Square;
Square.prototype.area = function () {
  return this.side * this.side;
};
module.exports = Square;
