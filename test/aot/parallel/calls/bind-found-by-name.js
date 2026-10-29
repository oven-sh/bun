// `f.bind(..)` where neither the function nor `bind` is known at the site: what it makes is a bound function in every respect.
const unknown = new Function("value", "return value" + process.argv[0].slice(process.argv[0].length));
const lines = [];
const show = (label, value) => lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
const attempt = action => {
  try {
    return action();
  } catch (error) {
    return error.constructor.name + ": " + error.message;
  }
};

function plain(a, b, c, d, e) {
  "use strict";
  return [this === undefined ? "undefined" : this === null ? "null" : typeof this === "object" ? this.tag : String(this), a, b, c, d, e, arguments.length].join();
}
function Point(x, y) {
  this.x = x;
  this.y = y;
}
Point.prototype.sum = function () { return this.x + this.y; };
const arrow = (a, b) => [a, b].join();
const holder = { tag: "holder", method(a, b) { return [this.tag, a, b].join(); } };
class Shape {
  constructor(name, sides) { this.name = name; this.sides = sides; }
  describe(suffix) { return this.name + this.sides + suffix; }
  static make(name) { return new this(name, 0); }
}
async function later(a, b) { return [this && this.tag, a, b].join(); }
function* steps(a, b) { yield a; yield b; }
const receiver = { tag: "receiver" };

function describe(label, target, bound, boundArguments) {
  show(label, [
    typeof bound, bound.name, bound.length, Object.getOwnPropertyNames(bound).sort().join(), "prototype" in bound,
    Object.getPrototypeOf(bound) === Object.getPrototypeOf(target), String(bound), Object.prototype.toString.call(bound), boundArguments,
  ]);
}

for (const [label, target] of [["plain", plain], ["constructor function", Point], ["arrow", arrow], ["method", holder.method], ["class", Shape], ["static method", Shape.make], ["async", later], ["generator", steps]]) {
  const hidden = unknown(target);
  describe(label + " without arguments", target, hidden.bind(), 0);
  describe(label + " with this", target, hidden.bind(receiver), 0);
  describe(label + " with one", target, hidden.bind(receiver, 1), 1);
  describe(label + " with two", target, hidden.bind(receiver, 1, 2), 2);
  describe(label + " with three", target, hidden.bind(receiver, 1, 2, 3), 3);
  describe(label + " with four", target, hidden.bind(receiver, 1, 2, 3, 4), 4);
  describe(label + " with six", target, hidden.bind(receiver, 1, 2, 3, 4, 5, 6), 6);
}

const hiddenPlain = unknown(plain);
show("calls", [
  hiddenPlain.bind()(), hiddenPlain.bind(undefined)(1), hiddenPlain.bind(null)(1, 2), hiddenPlain.bind(receiver)(1, 2, 3), hiddenPlain.bind(7, "a")("b"),
  hiddenPlain.bind(receiver, "a", "b")("c", "d", "e", "f"), hiddenPlain.bind(receiver, "a", "b", "c")("d"), hiddenPlain.bind(receiver, "a", "b", "c", "d")("e", "f"),
  hiddenPlain.bind(receiver, undefined)(undefined), hiddenPlain.bind(receiver).call({ tag: "other" }, 1), hiddenPlain.bind(receiver).apply({ tag: "other" }, [1, 2]),
]);
show("bound of bound", [
  unknown(hiddenPlain.bind(receiver, 1)).bind({ tag: "second" }, 2)(3), unknown(hiddenPlain.bind(receiver, 1)).bind(null, 2).name, unknown(hiddenPlain.bind(receiver, 1)).bind(null, 2).length,
  unknown(unknown(hiddenPlain.bind(receiver)).bind(null)).bind(null, 1, 2, 3, 4, 5, 6).length,
]);

const BoundPoint = unknown(Point).bind(receiver, 3);
const point = new BoundPoint(4);
show("new", [point.x, point.y, point.sum(), point instanceof Point, point instanceof BoundPoint, Object.getPrototypeOf(point) === Point.prototype, receiver.x === undefined]);
const BoundShape = unknown(Shape).bind(null, "square");
const shape = new BoundShape(4);
show("new of a class", [shape.describe("!"), shape instanceof Shape, shape instanceof BoundShape, attempt(() => BoundShape(4))]);
show("a class that extends a bound class", attempt(() => class extends BoundShape {}));
show("Reflect.construct", attempt(() => { const made = Reflect.construct(BoundPoint, [9], Shape); return [made.x, made.y, made instanceof Shape, made instanceof Point].join(); }));
const kindOfError = action => attempt(action).split(":")[0];
show("new of what cannot construct", [kindOfError(() => new (unknown(arrow).bind(null))()), kindOfError(() => new (unknown(holder.method).bind(null))()), kindOfError(() => new (unknown(later).bind(null))())]);
show("static method", unknown(Shape.make).bind(Shape)("made").name);
show("generator", [...unknown(steps).bind(null, 1)(2)]);

function renamed() {}
Object.defineProperty(renamed, "name", { value: "another" });
Object.defineProperty(renamed, "length", { value: 9 });
function unnamed() {}
delete unnamed.name;
delete unnamed.length;
function oddly(a, b) {}
Object.defineProperty(oddly, "name", { value: 5 });
Object.defineProperty(oddly, "length", { value: "text" });
function counted() {}
let reads = "";
Object.defineProperty(counted, "length", { get() { reads += "length "; return 4.7; } });
Object.defineProperty(counted, "name", { get() { reads += "name "; return "got"; } });
function extended(a) {}
extended.extra = 1;
function reparented(a, b) {}
Object.setPrototypeOf(reparented, { custom: true, bind: Function.prototype.bind });
show("changed functions", [renamed, unnamed, oddly, counted, extended, reparented].map(target => { const bound = unknown(target).bind(null, 1); return [bound.name, bound.length, Object.getPrototypeOf(bound).custom === true].join(); }));
show("order of reads", reads);
const lateName = unknown(function original(a, b) {}).bind(null);
show("name and length are those at the time of bind", (() => { const target = function early(a, b, c) {}; const bound = unknown(target).bind(null); Object.defineProperty(target, "name", { value: "late" }); Object.defineProperty(target, "length", { value: 0 }); return [bound.name, bound.length, lateName.name, lateName.length]; })());

for (const value of [undefined, null, 1, "text", {}, [], Symbol.iterator, Object.create(Function.prototype)])
  show("bind of " + (typeof value === "symbol" ? "symbol" : JSON.stringify(value)), attempt(() => Function.prototype.bind.call(unknown(value), null)));
show("host functions", [unknown(Math.max).bind(null, 3)(1, 7), unknown(Math.max).bind(null, 3).name, unknown(Math.max).bind(null, 3).length, unknown(Array.prototype.map).bind([1, 2], value => value * 2)().join(), unknown(console.log).bind(console).name]);
show("a proxy", (() => { const proxy = new Proxy(plain, {}); const bound = unknown(proxy).bind(receiver, 1); return [bound(2), bound.name, bound.length]; })());
const ownBind = unknown({ bind(...values) { return "own " + values.length; } });
show("another bind", [ownBind.bind(), ownBind.bind(1, 2, 3)]);

const kept = [];
for (let i = 0; i < 20000; i++) {
  const bound = hiddenPlain.bind(receiver, i, "k");
  if (i % 4000 === 0) kept.push(bound);
}
show("many", kept.map(bound => bound("z")));
unknown(later).bind(receiver, 1)(2).then(value => { show("async", value); console.log(lines.join("\n")); });
