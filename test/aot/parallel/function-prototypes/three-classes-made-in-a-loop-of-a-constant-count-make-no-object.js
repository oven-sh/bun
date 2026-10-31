// Three classes as they were written before `class`, made and called in a loop in the code of the module whose count is a constant.
// No object is made, and no call and no store looks a name up.
// Alone: what the compiler knows of a method goes by all that the executable holds, and with it what is counted here
// COUNT: cells <= 60
// COUNT: arrivals <= 80
// COUNT: branches <= 300000
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
Square.prototype = Object.create(Base.prototype);
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
function Cube(size) {
  Square.call(this, size);
  this.depth = size;
}
Cube.prototype = Object.create(Square.prototype);
Cube.prototype.constructor = Cube;
Cube.prototype.area = function () {
  return this.size * this.depth * 6;
};
function turn(i) {
  return new Square(i & 7).area() + new Round(i & 3).area() + new Cube(i & 1).area();
}
let sum = 0;
for (let i = 0; i < 20000; i++) sum += turn(i);
console.log(sum);
