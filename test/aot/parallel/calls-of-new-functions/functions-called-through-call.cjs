// `(function () { .. }).call(object, value)` enters the function, with what Function.prototype.call would hand it.
const lines = []; const say = (...values) => lines.push(values.map(value => typeof value === "object" && value ? Object.prototype.toString.call(value) : String(value)).join(" "));
(function () { say("no arguments", this === globalThis, arguments.length); }).call();
(function () { say("null", this === globalThis); }).call(null);
(function () { say("number", typeof this, this + 1); }).call(5);
(function (a, b, c = 3) { say(this.name, a, b, c, arguments.length); }).call({ name: "object" }, 1, 2);
((a, b) => { say("arrow", this === module.exports, a, b); }).call({ name: "ignored" }, 1, 2);
say((function (...rest) { return rest.length + this.n; }).call({ n: 10 }, 1, 2, 3));
say([1, 2, 3].map(x => (function (y) { return this.x * y; }).call({ x }, 10)).join());
let order = ""; const step = (name, value) => { order += name; return value; };
(function (a, b) { say(order, this, a, b); }).call(step("t", "this"), step("a", 1), step("b", 2));
try { (function () { throw new RangeError("thrown " + this.n); }).call({ n: 4 }); } catch (error) { say(error.constructor.name, error.message); }
try { (function () { say("never"); }).call((() => { throw new Error("argument"); })()); } catch (error) { say(error.message); }
const values = [1, 2, 3];
say((function (...rest) { return rest.join(); }).call(undefined, ...values), (function (...rest) { return rest.join(); }).call(...values));
say((function fact(n) { return n < 2 ? 1 : n * fact.call(null, n - 1); }).call(null, 6));
let depth = 0; (function again() { if (++depth < 4) again(); }).call(this); say("again", depth);
const kept = []; for (let i = 0; i < 3; i++) (function () { class Local { constructor() { this.i = i; } static made = i; } kept.push(Local); let count = 0; kept.push(() => ++count + i); }).call(this);
say(kept.map(value => (value.made ?? -1) + ":" + (value.prototype ? new value().i : value() + value())).join(), kept[0] === kept[2]);
say([...(function* (n) { for (let i = 0; i < n; i++) yield this.k * i; }).call({ k: 2 }, 4)].join());
(async function (n) { say("async", this.m, n); return n; }).call({ m: "m" }, 3).then(value => { say("then", value); console.log(lines.join("\n")); });
say((function () { return typeof this; })["call"]("text"), (function () { return this; })?.call(7) + 1, new (function (n) { this.n = n; }.bind(null, 3))().n);
const wrapped = (function (exports) {
  var total = 0;
  class Point { constructor(x, y) { this.x = x; this.y = y; } add(other) { return new Point(this.x + other.x, this.y + other.y); } static origin = null; }
  Point.origin = new Point(0, 0);
  exports.sum = function (n) { let point = Point.origin; for (let i = 0; i < n; i++) point = point.add(new Point(i, 0.5)); total += point.x; return [point.x, point.y, total].join(); };
  exports.isPoint = value => value instanceof Point; exports.make = (x, y) => new Point(x, y); exports.owner = this;
  return exports;
}).call({ owner: 1 }, {});
say(wrapped.sum(10), wrapped.sum(4), wrapped.isPoint(wrapped.make(1, 2)), wrapped.isPoint({}), Object.keys(wrapped).join(), wrapped.owner.owner);
(function () { say("inner", (function () { return this.v; }).call({ v: this.v + 1 })); }).call({ v: 1 });
say((() => (function () { return this.tail; }).call({ tail: "returned" }))());
