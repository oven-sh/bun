"use strict";
const lines = [];
const tell = (...values) => lines.push(values.map(String).join(" "));

function Shape() {
  this.radius = 0;
}
Shape.prototype.copy = function () {
  return null;
};
Shape.prototype.set = function (other) {
  this.radius = other.radius;
};
Shape.prototype.area = function () {
  return this.radius;
};
function heir(constructor) {
  constructor.prototype = Object.create(Shape.prototype);
  constructor.prototype.constructor = constructor;
}
function Circle(radius) {
  this.radius = radius;
  this.center = { x: radius };
}
heir(Circle);
Circle.prototype.copy = function () {
  const made = new Circle(0);
  made.set(this);
  return made;
};
Circle.prototype.set = function (other) {
  this.radius = other.radius;
  this.center.x = other.center.x;
};
Circle.prototype.area = function () {
  return 3.5 * this.radius + this.center.x;
};
function Box(side) {
  this.side = side;
}
heir(Box);
Box.prototype.copy = function () {
  const made = new Box(0);
  made.set(this);
  return made;
};
Box.prototype.set = function (other) {
  this.side = other.side;
};
Box.prototype.area = function () {
  return this.side * this.side;
};
function Plain() {}
heir(Plain);

function pick(i) {
  if (i % 4 === 0) return Circle;
  if (i % 4 === 1) return Box;
  return i % 4 === 2 ? Plain : Shape;
}
const seen = [];
function Fixture() {
  this.shape = null;
}
Fixture.prototype.create = function (def) {
  this.shape = def.shape.copy();
};
const run = count => {
  const fixture = new Fixture();
  const def = { shape: null };
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const Kind = pick(i);
    def.shape = new Kind(i);
    fixture.create(def);
    if (fixture.shape) sum += fixture.shape.area() || 0;
    if (def.shape instanceof Kind) sum += 0.25;
    if (def.shape instanceof pick(i + 1)) sum += 100;
    sum += def.shape.constructor === Kind ? 1 : 0.5;
  }
  return sum;
};
tell(run(8), run(60));

Plain.prototype.copy = function () {
  seen.push(this instanceof Plain, Object.keys(this).length);
  return this;
};
tell(run(8), seen.join());

const makers = [Circle, Box, Plain, Shape].map(kind => value => new kind(value));
let total = 0;
for (let i = 0; i < 24; i++) total += makers[i % 4](i).area() || 0;
tell(total);

Object.defineProperty(Box, Symbol.hasInstance, {
  value(value) {
    seen.push(this === Box);
    return value.side > 2;
  },
});
tell(run(8), seen.length, seen[seen.length - 1]);

Circle.prototype.set = function (other) {
  this.radius = "r" + other.radius;
};
tell(run(5));
Circle.prototype.set = function (other) {
  Object.setPrototypeOf(this, Shape.prototype);
  this.radius = other.radius;
};
tell(run(9));
const kinds = [Circle, Box, Plain, Shape, class Late extends Shape {}, function () { return { area: () => 5, copy() { return this; } }; }];
total = 0;
for (let i = 0; i < 30; i++) {
  const Kind = kinds[i % 6];
  const made = new Kind(i);
  total += made.area() || 0;
  if (i === 20) kinds[0] = new Proxy(Circle, { construct: (target, [radius]) => new target(radius * 2) });
}
tell(total, kinds.map(kind => kind.name).join());
console.log(lines.join("\n"));
