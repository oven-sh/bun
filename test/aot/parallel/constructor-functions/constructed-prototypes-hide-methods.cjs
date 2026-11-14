// A constructor function fills a name that its prototype has a method under, and an object that it constructs is the prototype of another function.
function Queue(limit) {
  this.limit = limit;
  this.size = 0;
  this.label = "queue";
}
Queue.prototype.size = function () {
  return this.limit;
};
Queue.prototype.label = function () {
  return "a queue";
};

function Ring() {}
Ring.prototype = new Queue(4);
const sizeOfRing = Ring.prototype.size;
const labelOfRing = Ring.prototype.label;
const readSize = () => sizeOfRing;
const readLabel = () => labelOfRing;
console.log(readSize(), typeof readSize(), readLabel(), typeof readLabel());

const ring = new Ring();
function sizeOf(object, depth) {
  if (depth > 0) return sizeOf(object, depth - 1);
  return object.size;
}
console.log(sizeOf(ring, 2), sizeOf(new Queue(9), 1), sizeOf(Ring.prototype, 1));
function nameOf(value) {
  if (value === undefined) return "nothing";
  return typeof value;
}
for (let i = 0; i < 3; i++) console.log(nameOf(sizeOf(ring, i)), nameOf(Queue.prototype.size));
try {
  console.log(ring.size());
} catch (error) {
  console.log(error.name);
}
console.log(Queue.prototype.size.call(new Queue(5)), Queue.prototype.label.call(ring));

// The method comes later, on both prototypes.
function Shape() {
  this.area = 7.5;
  this.corners = ["a", "b"];
}
function Square() {}
Square.prototype = new Shape();
{
  const area = Square.prototype.area;
  const corners = Square.prototype.corners;
  Square.prototype.area = function () {
    return typeof area === "function" ? area.call(this) : area;
  };
  Square.prototype.corners = function () {
    return typeof corners === "function" ? corners.call(this) : corners.join();
  };
}
Shape.prototype.area = function () {
  return "shape";
};
Shape.prototype.corners = function () {
  return "none";
};
const square = new Square();
console.log(square.area(), square.corners(), new Shape().area, new Shape().corners.length);
console.log(Object.keys(Square.prototype).join(), "area" in square, Object.hasOwn(Square.prototype, "area"), Object.hasOwn(square, "area"));

// Two constructed prototypes above each other.
function Base() {
  this.run = "base";
}
Base.prototype.run = function () {
  return "run";
};
function Middle() {}
Middle.prototype = new Base();
function Leaf() {}
Leaf.prototype = new Middle();
const found = [];
for (let i = 0; i < 4; i++) found.push(Leaf.prototype.run);
console.log(found.join(), found.map(value => typeof value).join(), typeof found[1]);
class Below extends Leaf {
  get inherited() {
    return super.run;
  }
}
console.log(new Below().inherited, new Leaf().run, new Middle().run);
Middle.prototype.run = function () {
  return "middle";
};
const { run = "default" } = Leaf.prototype;
const getRun = () => run;
console.log(typeof getRun(), getRun()(), new Leaf().run(), new Base().run);
