function Vector(x, y) {
  this.x = x;
  this.y = y;
}
Vector.prototype.plus = function (other) {
  if (!(other instanceof Vector)) throw new TypeError("not a vector");
  return new Vector(this.x + other.x, this.y + other.y);
};
Vector.prototype.length2 = function () {
  return this.x * this.x + this.y * this.y;
};
Vector.version = "1.0.0";
module.exports = Vector;
