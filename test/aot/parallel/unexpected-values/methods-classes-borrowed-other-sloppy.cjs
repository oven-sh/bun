// Methods of classes are borrowed for other receivers sloppy.
const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

console.log("strict:", (function () { return this === undefined; })());

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
  reset() {
    this.x = 1;
    return this;
  }
}
class Stack extends Array {
  add() {
    this.push(1);
    return this.length;
  }
  all() {
    const seen = [];
    for (const x of this) seen.push(x);
    return seen;
  }
}
function OldPoint(x, y) {
  this.x = x;
  this.y = y;
}
OldPoint.prototype.sum = function () {
  return this.x + this.y;
};
OldPoint.prototype.reset = function () {
  this.x = 1;
  return this;
};

const objects = [
  ["accessors", () => ({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })],
  ["a proxy", () => logged({ y: 2, x: 1 })],
  ["a frozen object", () => Object.freeze({ x: 5, y: 6 })],
  ["texts in another order", () => ({ y: "2", x: "1" })],
  ["inherited members", () => Object.create({ x: 3, y: 4 })],
  ["an instance of the other kind", () => new OldPoint(7, 8)],
  ["an array", () => [1, 2]],
  ["a number", () => 5],
  ["a text", () => "xy"],
  ["undefined", () => undefined],
];
const arrays = [
  ["an array", () => [5, 6]],
  ["a subclass with its own push and iterator", () => Odd.of(5, 6)],
  ["an array-like", () => ({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })],
  ["a proxy", () => logged([5, 6])],
  ["a frozen array", () => Object.freeze([5, 6])],
  ["a text", () => "ab"],
  ["arguments", () => (function () { return arguments; })(5, 6)],
];

for (let i = 0; i < 2000; i++) {
  new Point(1, 2).sum();
  new Point(0, 2).reset();
  new OldPoint(1, 2).sum();
  new OldPoint(0, 2).reset();
  Stack.of(5, 6).add();
  Stack.of(5, 6).all();
}

const methods = [
  ["Point.sum", Point.prototype.sum, objects, () => new Point(1, 2)],
  ["Point.reset", Point.prototype.reset, objects, () => new Point(0, 2)],
  ["OldPoint.sum", OldPoint.prototype.sum, objects, () => new OldPoint(1, 2)],
  ["OldPoint.reset", OldPoint.prototype.reset, objects, () => new OldPoint(0, 2)],
  ["Stack.add", Stack.prototype.add, arrays, () => Stack.of(5, 6)],
  ["Stack.all", Stack.prototype.all, arrays, () => Stack.of(5, 6)],
];
for (const [name, method, receivers, own] of methods) {
  for (const [label, make] of receivers) {
    attempt(name + " through call on " + label, () => method.call(make()));
    attempt(name + " through Reflect.apply on " + label, () => Reflect.apply(method, make(), []));
    attempt(name + " bound to " + label, () => method.bind(make())());
    attempt(name + " on its own kind", () => method.call(own()));
  }
}
attempt("Point.sum as a member of another object", () => ({ x: "a", y: "b", sum: Point.prototype.sum }).sum());
attempt("Point.sum inherited by an object that is no Point", () => Object.create(Point.prototype, { x: { get() { log.push("get x"); return 1; } }, y: { value: 2 } }).sum());
attempt("Point.sum taken off and called bare", () => (0, Point.prototype.sum)());
attempt("OldPoint.sum taken off and called bare", () => typeof (0, OldPoint.prototype.sum)());
attempt("an instance whose prototype is swapped", () => Object.setPrototypeOf(new Point(1, 2), OldPoint.prototype).sum());
attempt("an instance whose member is deleted", () => {
  const point = new Point(1, 2);
  delete point.x;
  return [point.sum(), point.reset(), point.sum()];
});
