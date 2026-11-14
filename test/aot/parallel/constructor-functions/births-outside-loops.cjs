// A birth outside a loop asks one guard for the method that fills the object and for the prototype, and makes one object.
// STATISTIC: OperationsSwept <= 540
function Class() {
  return function () {
    this.initialize.apply(this, arguments);
  };
}
var Shapes = {};
Shapes.Vector = Class();
Shapes.Vector.prototype = {
  initialize: function (x, y) {
    this.x = x ? x : 0;
    this.y = y ? y : 0;
  },
  dot: function (other) {
    return this.x * other.x + this.y * other.y;
  },
};
Shapes.Label = Class();
Shapes.Label.prototype = {
  initialize: function (text) {
    this.text = text;
  },
};
const operations = {
  add: function (left, right) {
    return new Shapes.Vector(left.x + right.x, left.y + right.y);
  },
  subtract: function (left, right) {
    return new Shapes.Vector(left.x - right.x, left.y - right.y);
  },
};
function name(text) {
  return new Shapes.Label(text);
}
const left = new Shapes.Vector(1.5, 2.5);
const right = new Shapes.Vector(0.5, 0);
const names = ["add", "subtract", "subtract", "add"];
let last = left;
for (const which of names) last = operations[which](last, right);
console.log(last.dot(right), name("a").text, Object.keys(last).join());
