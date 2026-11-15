"use strict";
const quiet = Object.assign({}, console, { log() {} });
const lines = [];
const tell = (...values) => lines.push(values.map(String).join(" "));
const attempt = run => {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
};
function Point(x) {
  this.x = x;
}
Point.prototype.take = function (other) {
  this.x = other.x;
  return this;
};
class Box {
  constructor(side) {
    this.side = side;
    this.list = new Array(1, true, "ab", 2.5);
  }
  fill(count) {
    for (let i = 0; i < count; i++) this.list[i] = new Point(this.side + i);
    return this;
  }
  text() {
    let text = "";
    for (let i = 0; i < this.list.length; i++) text += typeof this.list[i].x + typeof this.list[i].kept + (this.list[i].depth === undefined ? "-" : this.list[i].depth) + " ";
    return text;
  }
  take(point) {
    let text = "";
    for (let i = 0; i < this.list.length; i++) text += attempt(() => typeof this.list[i].take(point)) + " ";
    return text;
  }
}
const run = count => {
  const box = new Box(0.5);
  return box.text() + box.take(new Point(1)) + box.fill(count).text() + box.take(new Point(2));
};
tell(run(0), run(2), run(4), typeof quiet.warn);

const put = (holder, name, value) => {
  holder[name] = value;
};
const prototypes = [Number, Boolean].map(made => made.prototype);
put(prototypes[0], "kept", 3);
tell(run(1));
put(Object.getPrototypeOf(true), ["de", "pth"].join(""), 4);
tell(run(1), (false).depth, (1).depth);
Object.defineProperty((1).constructor.prototype, "x", { configurable: true, get() { return this + 1; } });
tell(run(1), (4).x, new Box(1).list[0].x + 1);
Reflect.set(String.prototype, "take", function (point) {
  return point;
});
tell(run(1), typeof "a".take({}));
for (const name of ["kept", "x"]) delete prototypes[0][name];
tell(run(1));
console.log(lines.join("\n"));
