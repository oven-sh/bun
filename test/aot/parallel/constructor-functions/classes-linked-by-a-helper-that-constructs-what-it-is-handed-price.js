// `function inherits(Below, Above) { Below.prototype = new Above(0); Below.prototype.constructor = Below; }`, called for each pair, as libraries linked their classes before Object.create.
// Each call has a helper of its own, in which the function above is known: what it makes is an ordinary object and none of the instances of that function.
// A method is called directly, an object that nobody keeps is not made, and no call and no store looks a name up.
// COUNT: arrivals <= 80
// COUNT: operations <= 200
// COUNT: cells <= 60
function inherits(Below, Above) {
  Below.prototype = new Above(0);
  Below.prototype.constructor = Below;
}
function Base(size) {
  this.size = size;
}
Base.prototype.area = function () {
  return this.size + 1;
};
function Square(size) {
  Base.call(this, size);
  this.sides = 4;
}
inherits(Square, Base);
Square.prototype.area = function () {
  return this.size * this.size + this.sides;
};
function Round(size) {
  Base.call(this, size);
  this.sides = 0;
}
inherits(Round, Base);
Round.prototype.area = function () {
  return this.size * 3 + this.sides;
};
function turn(i) {
  return new Base(i & 7).area() + new Square(i & 3).area() + new Round(i & 1).area();
}
let sum = 0;
for (let i = 0; i < 20000; i++) sum += turn(i);
console.log(sum, Object.keys(Square.prototype).join(), new Round(1) instanceof Base, Square.prototype.size);
