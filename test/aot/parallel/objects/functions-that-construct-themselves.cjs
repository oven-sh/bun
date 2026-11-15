// Functions that construct themselves when they are called without `new`.
"use strict";
const lines = [];
function Point(x, y) {
  if (!new.target) return new Point(x, y);
  this.x = x;
  this.y = y;
}
Point.prototype.add = function (other) {
  return Point(this.x + other.x, this.y + other.y);
};
function Vector(x) {
  if (!(this instanceof Vector)) return new Vector(x);
  this.x = x;
}
function Big(x) {
  if (x instanceof Big) return x;
  if (!(this instanceof Big)) return new Big(x);
  this.x = x;
}
Big.prototype.plus = function (other) {
  return new Big(this.x + Big(other).x);
};
function Tree(depth) {
  if (!new.target) return new Tree(depth);
  this.depth = depth;
  if (depth > 0) {
    this.left = Tree(depth - 1);
    this.right = new Tree(depth - 1);
  }
}
Tree.prototype.count = function () {
  return 1 + (this.left ? this.left.count() + this.right.count() : 0);
};
function Failing(x) {
  if (!new.target) return new Failing(x);
  if (x === 3) throw new RangeError("three");
  this.x = x;
}
function Other(x) {
  if (!new.target) return new Other(x);
  if (x & 1) return { x: "other" };
  this.x = x;
}
class Heir extends Point {
  constructor(x) {
    super(x, 1);
    this.own = new.target === Heir;
  }
}
function Called(x) {
  Vector.call(this, x);
  this.called = true;
}
Called.prototype = Object.create(Vector.prototype);
function run(turns) {
  let sum = Point(0, 0);
  const step = Point(1, 2);
  let vectors = 0;
  let big = Big(0);
  let failed = 0;
  let others = "";
  for (let turn = 0; turn < turns; turn++) {
    sum = sum.add(step);
    vectors += Vector(turn & 3).x;
    big = big.plus(turn & 1 ? Big(turn) : turn);
    try {
      failed += Failing(turn & 3).x;
    } catch (error) {
      failed += error.message.length;
    }
    if (turn < 4) others += Other(turn).x;
  }
  return [sum.x, sum.y, sum instanceof Point, vectors, big.x, failed, others].join();
}
for (let round = 0; round < 3; round++) lines.push(run(40));
lines.push(Tree(4).count(), new Tree(3).count(), Object.keys(Tree(0)).join());
lines.push(JSON.stringify(new Heir(5)), JSON.stringify(new Called(6)), new Called(7) instanceof Vector);
lines.push(Object.getPrototypeOf(Point(1, 1)) === Point.prototype, Reflect.construct(Point, [1, 2], Vector) instanceof Vector);
Point.prototype = { add: () => "replaced" };
lines.push(Point(1, 2).add(), Point(1, 2).constructor === Object);
console.log(lines.join("\n"));
