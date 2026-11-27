// Constructors that hand their arguments to a method, and methods that are called off prototype objects.
"use strict";
function Shape() {
  this.setUp.apply(this, arguments);
}
Shape.prototype.setUp = function (name, sides) {
  this.name = name;
  this.sides = sides;
  this.given = arguments.length;
};
Shape.prototype.area = function () {
  return this.sides;
};
Shape.prototype.told = function (before) {
  return before + this.name + this.area();
};
function Box() {
  Shape.prototype.setUp.call(this, "box", 4);
  this.setSizes.apply(this, arguments);
}
Box.prototype = Object.create(Shape.prototype);
Box.prototype.setSizes = function (wide, high) {
  this.wide = wide;
  this.high = high === undefined ? wide : high;
};
Box.prototype.area = function () {
  return this.wide * this.high;
};
function Crate() {
  if (arguments.length > 2) this.setUp.apply(this, [].slice.call(arguments, 1));
  else this.setUp.apply(this, arguments);
}
Crate.prototype = Object.create(Box.prototype);
Crate.prototype.setUp = function (wide, deep) {
  Box.prototype.setSizes.apply(this, arguments);
  this.deep = deep;
};
Crate.prototype.area = function () {
  return Box.prototype.area.call(this) * 2 + Shape.prototype.area.apply(this);
};
function all(count) {
  let sum = 0;
  let text = "";
  for (let at = 0; at < count; at++) {
    const shape = new Shape("s" + at, at % 5);
    const box = new Box(at, at % 3 ? 2 : undefined);
    const crate = at % 4 ? new Crate(at, 2) : new Crate("skipped", at, 3);
    sum += shape.area() + box.area() + (crate.area() || 0);
    text = shape.told(">") + box.told("=") + crate.told("#");
  }
  return sum + " " + text;
}
for (let round = 0; round < 20; round++) {
  const line = all(30 + round);
  if (round % 7 === 0) console.log(line);
}
console.log(new Shape().given, new Shape(1, 2, 3, 4).given, Object.keys(new Box(1)).join(), Object.keys(new Crate(1, 2)).join(), new Box("2", "3").area());
console.log(Shape.prototype.area.call({ sides: 77 }), Box.prototype.area.apply({ wide: 3, high: 5 }, [1]), Shape.prototype.told.call(new Box(6), "?"));
Shape.prototype.setUp = function (...rest) {
  this.rest = rest.length;
  return { name: "unused" };
};
console.log(Object.keys(new Shape(1, 2, 3)).join(), new Shape(1, 2, 3).rest, Object.keys(new Box(2)).join());
Box.prototype.setSizes = Shape.prototype.setUp;
console.log(Object.keys(new Box(9, 8)).join(), new Box(9, 8, 7).rest, String(new Box(9).area()));
Shape.prototype.setUp = undefined;
for (const kind of [Shape, Box, Crate]) {
  try {
    console.log(Object.keys(new kind(1)).join());
  } catch (error) {
    console.log(kind.name, error.constructor.name);
  }
}
