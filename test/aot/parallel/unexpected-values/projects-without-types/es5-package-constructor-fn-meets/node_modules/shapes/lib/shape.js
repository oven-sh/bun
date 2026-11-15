function Shape(name) {
  if (!(this instanceof Shape)) return new Shape(name);
  this.name = name;
  this.tags = [];
}
Shape.prototype.area = function () {
  return 0;
};
Shape.prototype.describe = function () {
  return this.name + " of area " + this.area();
};
Shape.prototype.tag = function (tag) {
  this.tags.push(tag);
  return this.tags.length;
};
Shape.isShape = function (value) {
  return value instanceof Shape;
};
module.exports = Shape;
