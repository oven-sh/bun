"use strict";
const lines = [];
const tell = (...values) => lines.push(values.map(String).join(" "));

const Box = {};
(function (box, nothing) {
  box.is = function (value, type) {
    if (value === null) return false;
    if (type instanceof Function && value instanceof type) return true;
    if (value.constructor.__implements !== nothing && value.constructor.__implements[type]) return true;
    return false;
  };
  box.named = function (table, type) {
    return table[type];
  };
})(Box);

function Circle(x) {
  this.x = x;
  this.next = null;
}
Circle.prototype.take = function (other) {
  if (Box.is(other, Circle)) this.x += other.x;
  return this.x;
};
function Square(x) {
  this.x = x;
  this.side = 2;
}
Square.prototype.take = function (other) {
  if (Box.is(other, Square)) this.x += other.side;
  return this.x;
};
function Segment(x) {
  this.x = x;
  this.ends = [x, x + 1];
}
Segment.prototype.take = function (other) {
  if (Box.is(other, Segment)) this.x += other.ends ? other.ends[1] : other.x;
  return this.x;
};
Circle.__implements = {};
Circle.__implements["shape"] = true;

const run = count => {
  const circle = new Circle(1);
  const square = new Square(2);
  const segment = new Segment(0.5);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    sum += circle.take(i % 3 ? circle : square);
    sum += square.take(i % 4 ? square : segment);
    sum += segment.take(i % 5 ? segment : circle);
    if (i % 8 === 7) circle.x = square.x = segment.x = i;
  }
  return sum;
};
tell(run(10), run(200));

const table = { shape: "by name", [String(Circle)]: "by text" };
tell(Box.named(table, "shape"), Box.named(table, Circle), Box.named(table, Square));

Square.toString = function () {
  this.asked = (this.asked || 0) + 1;
  return "shape";
};
tell(Box.named(table, Square), Square.asked, Box.is(new Circle(1), Square), Square.asked);
tell(run(10));

Segment[Symbol.toPrimitive] = function (hint) {
  this.hints = (this.hints || "") + hint + ";";
  return hint === "string" ? "shape" : 7;
};
tell(Box.named(table, Segment), Segment.hints, Segment + 1, Segment.hints, `${Segment}`, Segment.hints);
tell(Box.is(new Circle(1), Segment), run(10));

const handed = [];
Circle.toString = function () {
  handed.push(this === Circle);
  this.prototype.take = function (other) {
    return -1;
  };
  return "shape";
};
tell(run(3), handed.length);
tell(Box.named(table, Circle), handed.join());
tell(run(10));

Object.defineProperty(Square, Symbol.hasInstance, {
  value(value) {
    handed.push(this === Square, typeof value);
    return value.x > 100;
  },
});
tell(Box.is(new Square(1), Square), Box.is(new Segment(200), Square), handed.slice(-4).join());
tell(run(10));

const names = [];
const watched = new Proxy({}, {
  get(target, key) {
    names.push(typeof key === "string" ? key.slice(0, 16) : String(key));
    return key;
  },
});
tell(typeof Box.named(watched, Square), typeof Box.named(watched, Segment), names.join());
try {
  Segment[Symbol.toPrimitive] = () => ({});
  tell(Box.named(table, Segment));
} catch (error) {
  tell(error.constructor.name);
}
console.log(lines.join("\n"));
