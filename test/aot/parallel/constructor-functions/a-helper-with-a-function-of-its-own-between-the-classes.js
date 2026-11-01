// `function Between() {}; Between.prototype = Above.prototype; Below.prototype = new Between()`, as libraries wrote it so that the constructor above would not run.
let ran = 0;
function inherits(Below, Above) {
  function Between() {}
  Between.prototype = Above.prototype;
  Below.superClass_ = Above.prototype;
  Below.prototype = new Between();
  Below.prototype.constructor = Below;
}
function Base(size) { ran++; this.size = size; }
Base.prototype.area = function () { return this.size + 1; };
function Square(size) { Base.call(this, size); }
inherits(Square, Base);
Square.prototype.area = function () { return Square.superClass_.area.call(this) * 2; };
function Cube(size) { Square.call(this, size); }
inherits(Cube, Square);
let sum = 0;
for (let i = 0; i < 1000; i++) sum += new Square(i & 3).area() + new Cube(i & 1).area();
console.log(sum, ran, Object.keys(Square.prototype).join(), new Cube(1) instanceof Base, Object.getPrototypeOf(Cube.prototype) === Square.prototype);
