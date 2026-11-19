// Factories that are called at module level: each class gets code of its own, and nothing that the program sees changes.
const show = value => typeof value === "object" && value !== null ? "{" + Object.keys(value).map(key => key + ":" + show(value[key])).join() + "}" : String(value);
let created = 0;
var Class = { create: function () { created++; return function () { this.initialize.apply(this, arguments); }; } };

var Point = Class.create();
Point.prototype = {
  initialize: function (x, y) { this.x = x; this.y = y; },
  sum: function () { return this.x + this.y; },
};
var Segment = Class.create();
Segment.prototype = {
  initialize: function (from, name) { this.from = from; this.name = name; },
  sum: function () { return this.from.sum() + this.name.length; },
};
if (typeof Shapes === "undefined") var Shapes = {};
if (typeof Shapes.Round === "undefined") Shapes.Round = {};
Shapes.Round.Circle = Class.create();
Shapes.Round.Circle.prototype = {
  initialize: function (center, radius) { this.center = center; this.radius = radius; },
  sum: function () { return this.center.sum() * this.radius; },
};
function turns(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const point = new Point(i, 0.5);
    sum += new Segment(point, "s" + (i & 3)).sum() + new Shapes.Round.Circle(point, 2).sum();
  }
  return sum;
}
console.log(turns(50), created, show(new Segment(new Point(1), "n")), show(new Shapes.Round.Circle()));

// Each call creates a function of its own, with the name, the length and the prototype object that it has in the factory.
for (const constructor of [Point, Segment, Shapes.Round.Circle]) console.log(JSON.stringify(constructor.name), constructor.length, Object.getOwnPropertyNames(constructor).join());
console.log(Point === Segment, Point.prototype === Segment.prototype, new Point(1, 2) instanceof Segment, new Point(1, 2).constructor === Object, Object.getPrototypeOf(new Segment(1, "")) === Segment.prototype);
try { Point(1, 2); } catch (error) { console.log(error instanceof TypeError); }
console.log(Reflect.construct(Point, [1, 2], Segment) instanceof Segment ? "constructed" : "");

// What a factory captures, and what it is called on.
const library = {
  count: 0,
  extend(parent, methods) {
    const owner = this;
    function Child(...values) {
      owner.count++;
      if (new.target === undefined) return "called";
      if (parent) parent.apply(this, values);
      if (methods.start) methods.start.call(this, ...values);
    }
    Child.parent = parent;
    Child.prototype = Object.create(parent ? parent.prototype : Object.prototype);
    Object.assign(Child.prototype, methods, { constructor: Child });
    return Child;
  },
};
const Animal = library.extend(null, { start(name) { this.name = name; }, speak() { return this.name + " speaks"; } });
const Dog = library.extend(Animal, { start(name, age) { this.age = age; }, speak() { return Animal.prototype.speak.call(this) + " at " + this.age; } });
let text = 0;
for (let i = 0; i < 30; i++) text += new Dog("d" + i, i).speak().length;
console.log(text, library.count, Dog.parent === Animal, show(new Dog("rex", 3)), new Dog("a", 1) instanceof Animal, Dog(), Dog.name, Animal.length);

// The names of a factory mean what they mean where the factory is written.
const unit = "outer";
const tagged = function (tag) { return function (value) { this.value = value; this.text = tag + unit; }; };
{
  const unit = "inner";
  var First = tagged("1"), Second = tagged(unit);
}
console.log(show(new First(1)), show(new Second("2")));

// A factory that runs several times, and one that is stored again.
function again() { return Class.create(); }
const Third = again(), Fourth = again();
Third.prototype.initialize = function (a) { this.a = a; };
Fourth.prototype.initialize = function (b) { this.b = b; };
console.log(show(new Third(3)), show(new Fourth(4)), Third === Fourth, created);
const before = Class.create;
Class.create = function () { const made = before(); made.late = true; return made; };
var Late = Class.create();
Late.prototype.initialize = function (a) { this.late = a; };
console.log(show(new Late(5)), Late.late, created);
Object.defineProperty(Class, "create", { get() { console.log("read"); return before; }, configurable: true });
var Read = Class.create();
Read.prototype.initialize = function (a) { this.read = a; };
console.log(show(new Read(6)), created);
delete Class.create;
try { var None = Class.create(); } catch (error) { console.log(error instanceof TypeError, error.message); }

// Where an error of a factory and of its functions comes from.
const failing = { create(message) { if (message === "now") throw new Error(message); return function Failing() { throw new Error(message); }; } };
const Failing = failing.create("later"), Other = failing.create("other");
const frames = error => error.stack.split("\n").slice(1, 3).map(line => line.trim().replace(/\(.*[\\/]/, "(").replace(/at .*[\\/]/, "at ")).join(" | ");
for (const make of [() => new Failing(), () => new Other(), () => failing.create("now")]) try { make(); } catch (error) { console.log(error.message, frames(error)); }
try { var Broken = failing.create("now"); } catch (error) { console.log(error.message, frames(error)); }
