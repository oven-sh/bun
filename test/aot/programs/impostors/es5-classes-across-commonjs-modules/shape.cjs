function Shape(name, sides) {
  this.name = name;
  this.sides = sides;
}

Shape.prototype.describe = function () {
  return this.name + " with " + this.sides + " sides";
};

Shape.prototype.perimeter = function (edge) {
  return this.sides * edge;
};

module.exports = Shape;
