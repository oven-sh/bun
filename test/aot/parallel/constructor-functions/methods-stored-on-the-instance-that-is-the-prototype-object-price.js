// `Derived.prototype = new Base(0); Derived.prototype.area = function () { .. }`, as a decade of libraries linked their classes. The methods are stored onto what `new Base` made, and
// one of them stands in front of a method of Base. That object is none of the instances of Base: they hide nothing, and a method is called directly on them and on those of the classes below.
// An object that nobody keeps is not made, and no call and no store looks a name up.
// COUNT: arrivals <= 80
// COUNT: operations <= 200
// COUNT: cells <= 60
function Base(size) {
  this.size = size;
}
Base.prototype.area = function () {
  return this.size + 1;
};
Base.prototype.twice = function () {
  return this.size * 2;
};
function Square(size) {
  Base.call(this, size);
  this.sides = 4;
}
Square.prototype = new Base(0);
Square.prototype.constructor = Square;
Square.prototype.area = function () {
  return this.size * this.size + this.sides;
};
function Round(size) {
  Base.call(this, size);
  this.sides = 0;
}
Round.prototype = new Base(0);
Round.prototype.constructor = Round;
Round.prototype.area = function () {
  return this.size * 3 + this.sides;
};
function turn(i) {
  return new Base(i & 7).area() + new Square(i & 3).area() + new Round(i & 1).area() + new Square(i & 7).twice();
}
let sum = 0;
for (let i = 0; i < 20000; i++) sum += turn(i);
console.log(sum, Object.keys(Square.prototype).join(), new Round(1) instanceof Base, Square.prototype.size);
