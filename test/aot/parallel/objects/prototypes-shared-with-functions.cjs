// A function that makes objects shares the prototype object of their class. Objects that the function itself constructs, its subclasses and its other uses have the methods too.
"use strict";
const log = [];
function Point(x, y) {
  this.x = x;
  this.init(y);
}
var proto = Point.prototype;
proto.init = function (y) {
  this.y = y;
};
proto.sum = function () {
  return this.x + this.y;
};
var make = function make(x) {
  return new Point(x, 1);
};
make.prototype = proto;
function total(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) sum += points[i].sum();
  return sum;
}
const points = [];
for (let i = 0; i < 20; i++) points.push(make(i));
log.push(total(points), points[3] instanceof make, points[3] instanceof Point, {} instanceof make);

// `new` on the function, though it answers with another object, and on one that answers with nothing.
function Other(x) {
  if (x < 0) return new Point(x, 2);
  this.x = "other" + x;
  this.y = 0;
}
Other.prototype = Point.prototype;
const others = [new Other(-1), new Other(1), Reflect.construct(Point, [5, 6], Other), Reflect.construct(Other, [7], make)];
for (const other of others) log.push(other.sum(), other instanceof Other, other instanceof make, Object.getPrototypeOf(other) === proto, Object.keys(other).join());

class Below extends Other {
  constructor(x) {
    super(x);
    this.z = x;
  }
  twice() {
    return this.sum() + this.sum();
  }
}
const below = new Below(3);
log.push(below.twice(), below instanceof Point, below instanceof make);

const Bound = Other.bind(null, 9);
const bound = new Bound();
log.push(bound.sum(), bound instanceof Bound, bound instanceof Point);

const list = Array.from.call(Other, { length: 2, 0: "a", 1: "b" });
log.push(list.sum(), list.length, list instanceof Point, Reflect.construct(Array, [3], make).sum());

// The method changes through the function's property, and the property is replaced.
make.prototype.sum = function () {
  return 1000;
};
log.push(total(points), others[1].sum());
make.prototype = { sum: () => "replaced" };
log.push(points[0] instanceof make, points[0] instanceof Other, new make(4).sum(), Object.create(make.prototype).sum());
console.log(log.join("\n"));
