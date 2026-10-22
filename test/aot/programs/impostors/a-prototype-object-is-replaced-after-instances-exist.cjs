function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " -> threw " + error.constructor.name);
  }
}

function Point(x, y) {
  this.x = x;
  this.y = y;
}

Point.prototype.norm = function () {
  return this.x * this.x + this.y * this.y;
};
Point.prototype.kind = "first";

function makePoint(x, y) {
  return new Point(x, y);
}

function normOf(point) {
  return point.norm();
}

function kindOf(point) {
  return point.kind;
}

function isPoint(value) {
  return value instanceof Point;
}

function constructorOf(value) {
  const found = value.constructor;
  return found === Point ? "Point" : found === Object ? "Object" : show(found);
}

function look(label, point) {
  attempt(label + " norm()", () => normOf(point));
  attempt(label + " kind", () => kindOf(point));
  attempt(label + " instanceof Point", () => isPoint(point));
  attempt(label + " constructor", () => constructorOf(point));
  attempt(label + " keys", () => Object.keys(point).join());
}

const early = [];
let total = 0;
for (let i = 0; i < 2000; i++) {
  const point = makePoint(i % 7, 1);
  early.push(point);
  total += normOf(point);
  if (kindOf(point) !== "first" || !isPoint(point)) total = NaN;
}
console.log("2000 honest points", total);

const firstPrototype = Point.prototype;
Point.prototype = {
  norm: function () {
    return "second norm of " + this.x;
  },
  kind: "second",
};
const second = makePoint(5, 6);
look("made before the replacement", early[3]);
look("made after the replacement", second);
look("made after the replacement at a place that never made one", new Point(5, 6));
attempt("the early one still has the first prototype", () => Object.getPrototypeOf(early[3]) === firstPrototype);

Point[["proto", "type"].join("")] = Object.create(null, { kind: { value: "third" } });
const third = makePoint(7, 8);
look("made before both replacements", early[4]);
look("made between them", second);
look("made after a store under a joined name replaced it with an object without a prototype", third);

Point.prototype = 5;
const fourth = makePoint(9, 10);
look("made while the prototype property is a number", fourth);
attempt("its prototype is Object.prototype", () => Object.getPrototypeOf(fourth) === Object.prototype);
look("an early one while the prototype property is a number", early[5]);

Reflect.set(Point, "prototype", firstPrototype);
const fifth = makePoint(2, 3);
look("made after the first prototype came back", fifth);
look("an early one after that", early[6]);
look("the second one after that", second);

firstPrototype.norm = function () {
  return "patched norm of " + this.y;
};
look("an early one after the first prototype was patched", early[7]);
look("the second one after the first prototype was patched", second);

Point.prototype = {
  get x() {
    return "x from the getter, kept " + this.keptX;
  },
  set x(value) {
    this.keptX = value;
  },
  norm() {
    return "norm under accessors";
  },
  kind: "accessors",
};
look("made under a prototype with an accessor for x", makePoint(5, 6));
attempt("its x", () => makePoint(5, 6).x);
Point.prototype = Object.freeze({ x: "fixed x", kind: "frozen" });
look("made under a frozen prototype that has x", makePoint(5, 6));
attempt("its x", () => makePoint(5, 6).x);
Point.prototype = firstPrototype;

total = 0;
for (let i = 0; i < 2000; i++) total += early[i].x + makePoint(i % 3, 0).x;
console.log("fields are still read", total);
