"use strict";

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

console.log("strict:", (function () { return this === undefined; })());

class Base {
  sum() {
    return "the sum of the base class";
  }
}
class Point extends Base {
  constructor(x, y) {
    super();
    this.x = x;
    this.y = y;
  }
  sum() {
    return this.x + this.y;
  }
}
function OldBase() {}
OldBase.prototype.sum = function () {
  return "the sum of the old base";
};
function OldPoint(x, y) {
  this.x = x;
  this.y = y;
}
OldPoint.prototype = Object.create(OldBase.prototype);
OldPoint.prototype.constructor = OldPoint;
OldPoint.prototype.sum = function () {
  return this.x + this.y;
};
const literalPrototype = {
  __proto__: { sum: () => "the sum of the base object" },
  sum() {
    return this.x + this.y;
  },
};

function sumsPoints(p, results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(p.sum());
  }
  return "done";
}
function sumsOldPoints(p, results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(p.sum());
  }
  return "done";
}
function sumsHeirs(p, results, tick) {
  for (let i = 0; i < 6; i++) {
    tick(i);
    results.push(p.sum());
  }
  return "done";
}

const replacement = function () {
  return "replaced";
};
const unknown = value => new CustomEvent("unknown", { detail: value }).detail;
const key = () => ["s", "u", "m"].join("");
const ways = [
  ["a store", (prototype, p) => { prototype.sum = replacement; }],
  ["a store under a computed name", (prototype, p) => { prototype[key()] = replacement; }],
  ["a store through a name nobody can follow", (prototype, p) => { unknown(prototype).sum = replacement; }],
  ["Reflect.set", (prototype, p) => Reflect.set(prototype, "sum", replacement)],
  ["Reflect.set with the prototype as the receiver of another object", (prototype, p) => Reflect.set({}, "sum", replacement, prototype)],
  ["Object.defineProperty with a value", (prototype, p) => Object.defineProperty(prototype, "sum", { value: replacement })],
  ["Object.defineProperty with a getter", (prototype, p) => Object.defineProperty(prototype, "sum", { get() { log.push("get sum"); return replacement; } })],
  ["Reflect.defineProperty", (prototype, p) => Reflect.defineProperty(prototype, "sum", { value: replacement })],
  ["Object.defineProperties", (prototype, p) => Object.defineProperties(prototype, { sum: { value: replacement } })],
  ["Object.assign", (prototype, p) => Object.assign(prototype, { sum: replacement })],
  ["delete", (prototype, p) => delete prototype.sum],
  ["Reflect.deleteProperty", (prototype, p) => Reflect.deleteProperty(prototype, key())],
  ["an own member of the instance", (prototype, p) => { p.sum = replacement; }],
  ["an own member defined on the instance", (prototype, p) => Object.defineProperty(p, "sum", { value: replacement, configurable: true })],
  ["an own getter defined on the instance", (prototype, p) => Object.defineProperty(p, "sum", { get() { log.push("get own sum"); return replacement; }, configurable: true })],
  ["another prototype for the instance", (prototype, p) => Object.setPrototypeOf(p, { sum: replacement })],
  ["another prototype through __proto__", (prototype, p) => { p.__proto__ = { sum: replacement }; }],
  ["Reflect.setPrototypeOf", (prototype, p) => Reflect.setPrototypeOf(p, { sum: replacement })],
  ["a proxy as the prototype of the instance", (prototype, p) => Object.setPrototypeOf(p, new Proxy(prototype, { get(target, name, receiver) { log.push("get " + String(name)); return name === "sum" ? replacement : Reflect.get(target, name, receiver); } }))],
  ["a number in place of the method", (prototype, p) => { prototype.sum = 5; }],
];

const kinds = [
  ["a class", sumsPoints, Point.prototype, () => new Point(1, 2)],
  ["a constructor function", sumsOldPoints, OldPoint.prototype, () => new OldPoint(1, 2)],
  ["an heir of an object literal", sumsHeirs, literalPrototype, () => Object.assign(Object.create(literalPrototype), { x: 1, y: 2 })],
];
for (const [kind, use, prototype, make] of kinds) {
  const original = Object.getOwnPropertyDescriptor(prototype, "sum");
  for (let i = 0; i < 1000; i++) use(make(), [], () => {});
  for (const [label, change] of ways) {
    const p = make();
    const results = [];
    const end = outcome(() =>
      use(p, results, i => {
        if (i === 2) change(prototype, p);
        if (i === 4) {
          delete p.sum;
          Object.setPrototypeOf(p, prototype);
          Object.defineProperty(prototype, "sum", original);
        }
      }),
    );
    Object.defineProperty(prototype, "sum", original);
    const fresh = [];
    use(make(), fresh, () => {});
    console.log(kind + ", " + label + " -> " + show(results) + " " + end + " ; a fresh one " + show(fresh));
  }
}
