// A class extends an ordinary function: the function stores to this and has methods on its prototype object.
function Base(size) { this.size = size; }
Base.prototype.area = function () { return this.size * this.size; };
class Square extends Base {
  label = "square";
  constructor(size) { super(size); this.extra = size + 1; }
  describe() { return this.label + this.area() + this.extra; }
}
const made = new Square(3);
console.log(made.describe(), JSON.stringify(made), Object.keys(made).join(), made instanceof Base, made.constructor === Square);
