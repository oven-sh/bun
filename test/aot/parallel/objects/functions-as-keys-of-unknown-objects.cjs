"use strict";
const lines = [];
const tell = (...values) => lines.push(values.map(String).join(" "));
function Point(x) {
  this.x = x;
}
function Circle(x) {
  this.x = x;
}
function Named(x) {
  this.x = x;
}
Named.toString = () => "constructor";
function Primitive(x) {
  this.x = x;
}
Primitive[Symbol.toPrimitive] = hint => (hint === "string" ? "valueOf" : 1);
function Late(x) {
  this.x = x;
}
const read = (value, type) => value[type];
const implemented = (text, type) => typeof JSON.parse(text)[type];
const run = count => {
  const list = new Array(1, true);
  list[0] = new Point(0.5);
  let sum = 0;
  for (let i = 0; i < count; i++) {
    if (i > 3) list[1] = new Circle(2);
    const x = list[i & 1].x;
    sum += x === undefined ? 10 : x;
  }
  return sum;
};
tell(implemented("{}", Point), implemented('{"a":1}', Circle), run(10), run(1000));
tell(implemented("{}", Named), implemented("{}", Primitive));
tell(read(5, Named) === Number, read("text", Named) === String, typeof read(5, Primitive), read(true, Primitive) === Boolean.prototype.valueOf);
tell(typeof read({}, Late), read(7, Late));
Late.toString = function () {
  return "toFixed";
};
tell(typeof read(7, Late), run(10));
Object.defineProperty(Circle, Symbol.toPrimitive, { value: () => "constructor" });
tell(read(1, Circle) === Number, run(10));
const keys = [Point, Circle, Named, Primitive, Late];
tell(keys.map(key => typeof read(1, key)).join());
console.log(lines.join("\n"));
