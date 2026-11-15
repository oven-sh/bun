// Constructors that pass their arguments to a method (`this.initialize.apply(this, arguments)`), and methods that are called off prototype objects.
const factory = { create: function () { return function () { this.initialize.apply(this, arguments); }; } };
const show = value => typeof value === "object" && value !== null ? "{" + Object.keys(value).map(key => key + ":" + show(value[key])).join() + "}" : Object.is(value, -0) ? "-0" : String(value);

// Each argument keeps its place: objects, numbers and strings do not mix.
var Point = factory.create();
Point.prototype = {
  initialize: function (x, y) { this.x = x ? x : 0; this.y = y ? y : 0; },
  add: function (a, b) { return new Point(a.x + b.x, a.y + b.y); },
  dot: function (other) { return this.x * other.x + this.y * other.y; },
};
var Ray = function () { this.initialize.apply(this, arguments); };
Ray.prototype = {
  initialize: function (from, to, name) { this.from = from; this.to = to; this.name = name; },
  length: function () { return Point.prototype.add(this.from, this.to).dot(this.to); },
};
function turns(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const ray = new Ray(new Point(i, 1), new Point(2, -i), "r" + (i & 3));
    sum += ray.length() + ray.name.length;
  }
  return sum;
}
console.log(turns(50), show(new Ray(new Point(1), new Point(), "n")), show(new Ray(1, "two")), show(new Ray()));

// The arguments object is changed before it is passed on, or is named more than once.
function Changed() { arguments[0] = "changed"; this.initialize.apply(this, arguments); }
Changed.prototype.initialize = function (a, b) { this.a = a; this.b = b; };
function Twice() { this.first.apply(this, arguments); this.second.apply(this, arguments); }
Twice.prototype.first = function (a) { this.a = a; };
Twice.prototype.second = function (a, b) { this.b = b; };
function Kept() { this.kept = arguments; this.initialize.apply(this, arguments); this.kept[0] = "late"; }
Kept.prototype.initialize = function (a) { this.a = a; };
function Looped() { for (var i = 0; i < 2; i++) this.initialize.apply(this, arguments); }
Looped.prototype.initialize = function (a) { this.seen = (this.seen || "") + a; };
Looped.prototype.initialize.apply = function (object, list) { const result = Function.prototype.apply.call(this, object, list); list[0] = "mine"; return result; };
console.log(show(new Changed(1, new Point(1, 2))), show(new Twice("s", 2)), show(new Kept(3).a), show(new Looped("first")));

// A method of its own under `apply` gets the arguments object.
function Own() { this.initialize.apply(this, arguments); }
Own.prototype.initialize = function (a, b) { this.a = a; this.b = b; };
Own.prototype.initialize.apply = function (object, list) { list[0] = -0; return Function.prototype.apply.call(this, object, [list[1], list[0]]); };
for (let i = 0; i < 3; i++) console.log(show(new Own(i, "b" + i)));

// Calls from everywhere: too few, too many, spread, reflected, as a callback, out of sight.
console.log(show(new Point(...[1, 2, 3])), show(Reflect.construct(Point, ["3"])), [4, 5].map(function (value, index) { return show(new Point(value, index)); }).join(" "));
globalThis["Poi" + "nt"] = Point;
console.log(show(new globalThis["Po" + "int"]("out", "of sight")), turns(5));

// What initialize, add and the prototype object are may change.
Ray.prototype.initialize = function (from, to) { this.to = from; this.from = to; this.name = "swapped"; };
console.log(turns(5));
Point.prototype.add = function (a) { return a; };
console.log(turns(5));
Object.defineProperty(Ray.prototype, "name", { set(value) { this.text = "[" + value + "]"; }, get() { return this.text; }, configurable: true });
console.log(turns(5), show(new Ray(new Point(1, 1), new Point(2, 2))));
Point.prototype = { initialize: function (x) { this.x = this.y = x; }, add: function (a, b) { return new Point(b.y); }, dot: function (other) { return this.x - other.y; } };
console.log(turns(5), show(new Point(7)), show(Point.prototype.add(1, new Point(9))));
delete Ray.prototype.initialize;
try { console.log(turns(1)); } catch (error) { console.log(error instanceof TypeError); }
