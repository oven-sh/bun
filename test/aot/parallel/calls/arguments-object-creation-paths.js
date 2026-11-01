// The unmapped `arguments` object has the same elements and properties on every creation path (one property at a time, one copy of the elements, the stub), also after collections that run while no such object is alive.
"use strict";
const collectFull = globalThis.gc ?? (() => Bun.gc(true));
const collectEden = globalThis.edenGC ?? require("bun:jsc").edenGC;
const ring = new Array(64);
let thrower;

function capture() {
  return arguments;
}

function show(value) {
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "string" || (typeof value === "object" && value !== null)) return JSON.stringify(value);
  return Object.is(value, -0) ? "-0" : String(value);
}

function showDescriptor(object, key) {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return "none";
  return Object.keys(descriptor)
    .map(name => name + " " + show(descriptor[name]))
    .join(", ");
}

function showKeys(object) {
  return Reflect.ownKeys(object).map(String).join(",");
}

function readCallee(object) {
  try {
    return show(object.callee);
  } catch (error) {
    return "threw " + error.name;
  }
}

function describe(object) {
  const length = object.length;
  const elements = [];
  for (let i = 0; i < length; i++) elements.push(i in object ? show(object[i]) : "hole");
  const accessor = Reflect.getOwnPropertyDescriptor(object, "callee");
  thrower ??= accessor.get;
  const lines = [
    "elements: " + elements.join(","),
    "length: " + length,
    "keys: " + showKeys(object),
    "descriptor of length: " + showDescriptor(object, "length"),
    "descriptor of callee: " + showDescriptor(object, "callee"),
    "descriptor of Symbol.iterator: " + showDescriptor(object, Symbol.iterator),
    "descriptor of 0: " + showDescriptor(object, "0"),
    "class: " + Object.prototype.toString.call(object),
    "prototype is Object.prototype: " + (Object.getPrototypeOf(object) === Object.prototype),
    "iterator is Array.prototype.values: " + (object[Symbol.iterator] === Array.prototype.values),
    "one thrower for get and set in every object: " + (accessor.get === thrower && accessor.set === thrower),
    "read of callee: " + readCallee(object),
    "spread: " + [...object].map(show).join(","),
    "past the end: " + (length in object) + " " + show(object[length]),
  ];
  object.first = 1;
  object.second = 2;
  object[length] = "appended";
  lines.push("after three stores: " + showKeys(object) + " " + show(object.first) + " " + show(object.second) + " " + show(object[length]) + " " + object.length);
  return lines.join("\n  ");
}

function collect() {
  for (let i = 0; i < 20000; i++) ring[i & 63] = { index: i };
  collectEden();
  collectFull();
  for (let i = 0; i < 20000; i++) ring[i & 63] = { index: i };
}

function report(label, create) {
  console.log(label + ", call 1\n  " + describe(create()));
  console.log(label + ", call 2\n  " + describe(create()));
  collect();
  console.log(label + ", call 3\n  " + describe(create()));
}

const kinds = {
  integers: index => index,
  doubles: index => index + 0.5,
  "strings and objects": index => (index % 2 ? { index } : "text " + index),
  undefined: () => undefined,
};
for (const [kind, element] of Object.entries(kinds)) {
  for (const count of [0, 1, 2, 64, 65, 200]) {
    const list = Array.from({ length: count }, (_, index) => element(index));
    report(count + " " + kind, () => capture(...list));
  }
}
report("hole in a spread", () => capture(...[, 1]));
report("no arguments, called directly", () => capture());
report("integers, called directly", () => capture(1, 2, 3));
report("doubles, called directly", () => capture(0.5, 1.5));
report("NaN and -0, called directly", () => capture(NaN, -0, 0.5));
report("every kind, called directly", () => capture(1, 0.5, "text", { key: 1 }, [2], undefined, null, true, 10n, Symbol.iterator));

const withHole = capture(...[, 1]);
console.log("0 in arguments for a hole in a spread:", 0 in withHole, show(withHole[0]), withHole.length);

const one = capture(1, 2);
const other = capture(1, 2);
console.log("two calls create two objects:", one !== other);
one[0] = "stored";
console.log("after a store to arguments[0] of the first:", show(one[0]), show(other[0]));

function captureWithParameter(parameter) {
  return { object: arguments, read: () => parameter, store: value => void (parameter = value) };
}
const left = captureWithParameter("left");
const right = captureWithParameter("right");
left.object[0] = "stored";
console.log("after a store to arguments[0]:", show(left.object[0]), show(left.read()), show(right.object[0]), show(right.read()));
right.store("parameter");
console.log("after a store to the parameter:", show(right.object[0]), show(right.read()), show(left.object[0]), show(left.read()));
console.log("last allocation:", ring[63].index);
