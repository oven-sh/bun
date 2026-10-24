// Object.defineProperty with a descriptor written as an object literal at the call: every combination of members, on plain objects, functions, class instances and built-ins, and the same descriptors passed in variables.
const lines = [];
function say(label, value) {
  lines.push(label + ": " + value);
}
function keyText(key) {
  return typeof key === "symbol" ? key.toString() : JSON.stringify(key);
}
function valueText(value) {
  return typeof value === "function" ? "function " + value.name : String(value);
}
function describeKey(object, key) {
  const descriptor = Reflect.getOwnPropertyDescriptor(object, key);
  if (!descriptor) return "absent";
  const flags = (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
  if (Object.hasOwn(descriptor, "value")) return flags + " value " + valueText(descriptor.value);
  return flags + " get " + valueText(descriptor.get) + " set " + valueText(descriptor.set);
}
function keysOf(object) {
  return (typeof object === "function" ? Object.keys(object) : Reflect.ownKeys(object)).map(keyText).join();
}
function attempt(action) {
  try {
    return action();
  } catch (error) {
    return error.name + ": " + error.message;
  }
}
function hide(value) {
  return value;
}

const tag = Symbol("tag");
function getter() {
  return "got";
}
function setter() {}

const subsets = [
  [[], (object, key) => Object.defineProperty(object, key, {})],
  [["value"], (object, key) => Object.defineProperty(object, key, { value: 1 })],
  [["writable"], (object, key) => Object.defineProperty(object, key, { writable: true })],
  [["value", "writable"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true })],
  [["enumerable"], (object, key) => Object.defineProperty(object, key, { enumerable: true })],
  [["value", "enumerable"], (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: true })],
  [["writable", "enumerable"], (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: true })],
  [["value", "writable", "enumerable"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: true })],
  [["configurable"], (object, key) => Object.defineProperty(object, key, { configurable: true })],
  [["value", "configurable"], (object, key) => Object.defineProperty(object, key, { value: 1, configurable: true })],
  [["writable", "configurable"], (object, key) => Object.defineProperty(object, key, { writable: true, configurable: true })],
  [["value", "writable", "configurable"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, configurable: true })],
  [["enumerable", "configurable"], (object, key) => Object.defineProperty(object, key, { enumerable: true, configurable: true })],
  [["value", "enumerable", "configurable"], (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: true, configurable: true })],
  [["writable", "enumerable", "configurable"], (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: true, configurable: true })],
  [["value", "writable", "enumerable", "configurable"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: true, configurable: true })],
  [["get"], (object, key) => Object.defineProperty(object, key, { get: getter })],
  [["value", "get"], (object, key) => Object.defineProperty(object, key, { value: 1, get: getter })],
  [["writable", "get"], (object, key) => Object.defineProperty(object, key, { writable: true, get: getter })],
  [["value", "writable", "get"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, get: getter })],
  [["enumerable", "get"], (object, key) => Object.defineProperty(object, key, { enumerable: true, get: getter })],
  [["value", "enumerable", "get"], (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: true, get: getter })],
  [["writable", "enumerable", "get"], (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: true, get: getter })],
  [["value", "writable", "enumerable", "get"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: true, get: getter })],
  [["configurable", "get"], (object, key) => Object.defineProperty(object, key, { configurable: true, get: getter })],
  [["value", "configurable", "get"], (object, key) => Object.defineProperty(object, key, { value: 1, configurable: true, get: getter })],
  [["writable", "configurable", "get"], (object, key) => Object.defineProperty(object, key, { writable: true, configurable: true, get: getter })],
  [["value", "writable", "configurable", "get"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, configurable: true, get: getter })],
  [["enumerable", "configurable", "get"], (object, key) => Object.defineProperty(object, key, { enumerable: true, configurable: true, get: getter })],
  [["value", "enumerable", "configurable", "get"], (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: true, configurable: true, get: getter })],
  [["writable", "enumerable", "configurable", "get"], (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: true, configurable: true, get: getter })],
  [["value", "writable", "enumerable", "configurable", "get"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: true, configurable: true, get: getter })],
  [["set"], (object, key) => Object.defineProperty(object, key, { set: setter })],
  [["value", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, set: setter })],
  [["writable", "set"], (object, key) => Object.defineProperty(object, key, { writable: true, set: setter })],
  [["value", "writable", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, set: setter })],
  [["enumerable", "set"], (object, key) => Object.defineProperty(object, key, { enumerable: true, set: setter })],
  [["value", "enumerable", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: true, set: setter })],
  [["writable", "enumerable", "set"], (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: true, set: setter })],
  [["value", "writable", "enumerable", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: true, set: setter })],
  [["configurable", "set"], (object, key) => Object.defineProperty(object, key, { configurable: true, set: setter })],
  [["value", "configurable", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, configurable: true, set: setter })],
  [["writable", "configurable", "set"], (object, key) => Object.defineProperty(object, key, { writable: true, configurable: true, set: setter })],
  [["value", "writable", "configurable", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, configurable: true, set: setter })],
  [["enumerable", "configurable", "set"], (object, key) => Object.defineProperty(object, key, { enumerable: true, configurable: true, set: setter })],
  [["value", "enumerable", "configurable", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: true, configurable: true, set: setter })],
  [["writable", "enumerable", "configurable", "set"], (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: true, configurable: true, set: setter })],
  [["value", "writable", "enumerable", "configurable", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: true, configurable: true, set: setter })],
  [["get", "set"], (object, key) => Object.defineProperty(object, key, { get: getter, set: setter })],
  [["value", "get", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, get: getter, set: setter })],
  [["writable", "get", "set"], (object, key) => Object.defineProperty(object, key, { writable: true, get: getter, set: setter })],
  [["value", "writable", "get", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, get: getter, set: setter })],
  [["enumerable", "get", "set"], (object, key) => Object.defineProperty(object, key, { enumerable: true, get: getter, set: setter })],
  [["value", "enumerable", "get", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: true, get: getter, set: setter })],
  [["writable", "enumerable", "get", "set"], (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: true, get: getter, set: setter })],
  [["value", "writable", "enumerable", "get", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: true, get: getter, set: setter })],
  [["configurable", "get", "set"], (object, key) => Object.defineProperty(object, key, { configurable: true, get: getter, set: setter })],
  [["value", "configurable", "get", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, configurable: true, get: getter, set: setter })],
  [["writable", "configurable", "get", "set"], (object, key) => Object.defineProperty(object, key, { writable: true, configurable: true, get: getter, set: setter })],
  [["value", "writable", "configurable", "get", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, configurable: true, get: getter, set: setter })],
  [["enumerable", "configurable", "get", "set"], (object, key) => Object.defineProperty(object, key, { enumerable: true, configurable: true, get: getter, set: setter })],
  [["value", "enumerable", "configurable", "get", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: true, configurable: true, get: getter, set: setter })],
  [["writable", "enumerable", "configurable", "get", "set"], (object, key) => Object.defineProperty(object, key, { writable: true, enumerable: true, configurable: true, get: getter, set: setter })],
  [["value", "writable", "enumerable", "configurable", "get", "set"], (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: true, configurable: true, get: getter, set: setter })],
];
const otherLiterals = [
  ["value,!writable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: false })],
  ["value,!enumerable", (object, key) => Object.defineProperty(object, key, { value: 1, enumerable: false })],
  ["value,!configurable", (object, key) => Object.defineProperty(object, key, { value: 1, configurable: false })],
  ["value,!writable,!enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: false, enumerable: false, configurable: false })],
  ["value,writable,!enumerable,configurable", (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, enumerable: false, configurable: true })],
  ["!writable", (object, key) => Object.defineProperty(object, key, { writable: false })],
  ["!enumerable", (object, key) => Object.defineProperty(object, key, { enumerable: false })],
  ["!configurable", (object, key) => Object.defineProperty(object, key, { configurable: false })],
  ["get,!enumerable,!configurable", (object, key) => Object.defineProperty(object, key, { get: getter, enumerable: false, configurable: false })],
  ["value=undefined", (object, key) => Object.defineProperty(object, key, { value: undefined })],
  ["get=undefined", (object, key) => Object.defineProperty(object, key, { get: undefined })],
  ["set=undefined", (object, key) => Object.defineProperty(object, key, { set: undefined })],
  ["get=undefined,set=undefined", (object, key) => Object.defineProperty(object, key, { get: undefined, set: undefined })],
  ["get,set=undefined", (object, key) => Object.defineProperty(object, key, { get: getter, set: undefined })],
  ["get=1", (object, key) => Object.defineProperty(object, key, { get: 1 })],
  ["get=text", (object, key) => Object.defineProperty(object, key, { get: "text" })],
  ["get=null", (object, key) => Object.defineProperty(object, key, { get: null })],
  ["get=object", (object, key) => Object.defineProperty(object, key, { get: {} })],
  ["set=1", (object, key) => Object.defineProperty(object, key, { set: 1 })],
  ["set=null", (object, key) => Object.defineProperty(object, key, { set: null })],
  ["get,set=1", (object, key) => Object.defineProperty(object, key, { get: getter, set: 1 })],
  ["get=1,set=1", (object, key) => Object.defineProperty(object, key, { get: 1, set: 1 })],
];
const literals = [...subsets.map(([members, define]) => [members.join("+") || "nothing", define]), ...otherLiterals];

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  get sum() {
    return this.x + this.y;
  }
  norm() {
    return this.x * this.x + this.y * this.y;
  }
}
function readPoint(point) {
  return " | reads " + attempt(() => [point.x, point.y, point.sum, typeof point.norm].join());
}
function readNothing() {
  return "";
}

// Three rounds: the first definition from a Structure creates a transition, and the later ones follow it.
function run(define, create, key, read = readNothing) {
  const seen = new Set();
  for (let round = 0; round < 3; round++) {
    const target = create();
    const outcome = attempt(() => (define(target, key) === target ? "defined" : "returned something else"));
    seen.add(outcome + " | " + describeKey(target, key) + " | " + keysOf(target) + read(target));
  }
  return [...seen].join(" / ");
}

const targets = [
  ["an absent name", () => ({ other: 0 }), "k"],
  ["a data property", () => ({ k: "old", other: 0 }), "k"],
  ["an accessor", () => ({ get k() { return "old"; }, other: 0 }), "k"],
  ["a property with every attribute false", () => Object.defineProperty({ other: 0 }, "k", { value: "old" }), "k"],
  ["a non-extensible object", () => Object.preventExtensions({ other: 0 }), "k"],
  ["a frozen object", () => Object.freeze({ k: "old" }), "k"],
  ["an object without a prototype", () => Object.create(null), "k"],
  ["a symbol", () => ({ other: 0 }), tag],
  ["an index", () => ({ other: 0 }), "0"],
  ["__proto__", () => ({ other: 0 }), "__proto__"],
  ["an element of an array", () => ["old", "old"], "1"],
  ["the length of an array", () => ["old", "old"], "length"],
  ["a name on an array", () => ["old", "old"], "k"],
  ["a Map", () => new Map(), "k"],
  ["a function", () => function target() {}, "k"],
  ["the name of a function", () => function target() {}, "name"],
  ["the prototype of a function", () => function target() {}, "prototype"],
  ["the display name of a function", () => function target() {}, "displayName"],
  ["an arrow function", () => () => {}, "k"],
  ["a bound function", () => function target() {}.bind(null), "k"],
  ["a class", () => class Target { static declared = "old"; }, "k"],
  ["a static field", () => class Target { static declared = "old"; }, "declared"],
  ["a field of a class instance", () => new Point(1, 2), "x", readPoint],
  ["an undeclared name of a class instance", () => new Point(1, 2), "extra", readPoint],
  ["the name of a method, on a class instance", () => new Point(1, 2), "norm", readPoint],
  ["the name of an inherited getter, on a class instance", () => new Point(1, 2), "sum", readPoint],
  ["a frozen class instance", () => Object.freeze(new Point(1, 2)), "x", readPoint],
];

const memberValues = { value: 1, writable: true, enumerable: true, configurable: true, get: getter, set: setter };
function buildDescriptor(members) {
  return Object.fromEntries(members.map(member => [member, memberValues[member]]));
}
function compareWithVariables(create, key, read) {
  const differences = [];
  for (const [members, define] of subsets) {
    const written = run(define, create, key, read);
    const fromVariable = run((object, name) => Object.defineProperty(object, name, buildDescriptor(members)), create, key, read);
    if (written !== fromVariable) differences.push((members.join("+") || "nothing") + ": " + written + " but from a variable: " + fromVariable);
  }
  return differences.length ? differences.join("; ") : "the same " + subsets.length + " outcomes";
}

for (const [label, create, key, read] of targets) {
  const byOutcome = new Map();
  for (const [name, define] of literals) {
    const outcome = run(define, create, key, read);
    if (!byOutcome.has(outcome)) byOutcome.set(outcome, []);
    byOutcome.get(outcome).push(name);
  }
  for (const [outcome, names] of byOutcome) say(label + " <- " + names.join(" "), outcome);
  say(label + ", descriptors passed in variables", compareWithVariables(create, key, read));
}

function definesOnNewObject(i) {
  const object = { other: i };
  Object.defineProperty(object, "hidden", { value: i, writable: true });
  Object.defineProperty(object, "shown", { get: getter, enumerable: true, configurable: true });
  Object.defineProperty(object, tag, { value: i + 1 });
  Object.defineProperty(object, "other", { enumerable: false });
  return object;
}
function definesOnNewFunction(i) {
  const callable = function () {
    return i;
  };
  Object.defineProperty(callable, "index", { value: i });
  Object.defineProperty(callable, "label", { get: getter, enumerable: true });
  return callable;
}
function definesOnNewInstance(i) {
  const point = new Point(i, 1);
  Object.defineProperty(point, "id", { value: i, enumerable: true });
  Object.defineProperty(point, "y", { value: 2, writable: true, enumerable: true, configurable: true });
  return point;
}
const shapes = new Set();
let total = 0;
for (let i = 0; i < 100; i++) {
  const object = definesOnNewObject(i);
  const callable = definesOnNewFunction(i);
  const point = definesOnNewInstance(i);
  total += object.hidden + object[tag] + object.other + object.shown.length + callable.index + callable() + callable.label.length + point.id + point.sum;
  shapes.add([keysOf(object), Object.keys(object).join(), keysOf(callable), keysOf(point)].join(" ; "));
}
say("constant keys on new objects, 100 times", total + " | " + [...shapes].join(" / "));

function definesMany(count) {
  const object = {};
  for (let i = 0; i < count; i++) Object.defineProperty(object, "p" + i, { value: i, enumerable: true });
  return object;
}
say("past the inline capacity", [definesMany(20), definesMany(20), definesMany(21)].map(object => JSON.stringify(object)).join(" "));

const large = {};
for (let i = 0; i < 200; i++) large["k" + i] = i;
delete large.k5;
Object.defineProperty(large, "late", { value: "late", enumerable: true });
Object.defineProperty(large, "k7", { get: getter, enumerable: true, configurable: true });
Object.defineProperty(large, "k5", { value: "again" });
say("an object with 200 properties, one of them deleted", [describeKey(large, "late"), describeKey(large, "k7"), describeKey(large, "k5"), Object.keys(large).length, Object.keys(large).slice(-2).join()].join(" | "));

const failures = new Set();
for (let round = 0; round < 3; round++) {
  const failure = new RangeError("old");
  Object.defineProperty(failure, "code", { value: "E_OLD", enumerable: true });
  Object.defineProperty(failure, "cause", { get: getter, configurable: true });
  Object.defineProperty(failure, "message", { value: "new" });
  Object.defineProperty(failure, "stack", { value: "replaced" });
  failures.add([describeKey(failure, "code"), describeKey(failure, "cause"), describeKey(failure, "message"), describeKey(failure, "stack"), Object.keys(failure).join()].join(" | "));
}
say("an error", [...failures].join(" / "));

function readLate(object) {
  return object.late;
}
function storeGuarded(object, value) {
  "use strict";
  object.guarded = value;
}
const received = [];
function receive(value) {
  received.push(value);
}
for (let round = 0; round < 3; round++) {
  const withValue = { shared: round };
  const withGetter = { shared: round };
  const withReadOnly = { shared: round };
  const withSetter = { shared: round };
  let absent = 0;
  let stored = 0;
  for (let i = 0; i < 100; i++) {
    if (readLate(Object.create(withValue)) === undefined && readLate(Object.create(withGetter)) === undefined) absent++;
    const first = Object.create(withReadOnly);
    const second = Object.create(withSetter);
    storeGuarded(first, i);
    storeGuarded(second, i);
    if (Object.hasOwn(first, "guarded") && Object.hasOwn(second, "guarded")) stored++;
  }
  Object.defineProperty(withValue, "late", { value: "a value" });
  Object.defineProperty(withGetter, "late", { get: getter });
  Object.defineProperty(withReadOnly, "guarded", { value: "read-only" });
  Object.defineProperty(withSetter, "guarded", { set: receive });
  const afterReadOnly = Object.create(withReadOnly);
  const afterSetter = Object.create(withSetter);
  const rejected = attempt(() => storeGuarded(afterReadOnly, "ignored"));
  storeGuarded(afterSetter, "round " + round);
  say("a definition on a prototype after 100 reads and stores through it, round " + round, [absent, stored, readLate(Object.create(withValue)), readLate(Object.create(withGetter)), rejected, Object.hasOwn(afterReadOnly, "guarded"), Object.hasOwn(afterSetter, "guarded"), received.join()].join(" | "));
}

const order = [];
function noted(name, value) {
  order.push(name);
  return value;
}
Object.defineProperty(noted("object", {}), noted("key", "k"), { value: noted("value", 1), enumerable: noted("enumerable", true) });
say("operands are evaluated from left to right", order.join());
order.length = 0;
Object.defineProperty({}, { toString() { return noted("key to string", "k"); } }, { value: noted("value", 1) });
say("the key is converted after the descriptor is evaluated", order.join());
order.length = 0;
for (const target of [1, "text", null, undefined, true, tag, 10n]) say("on " + valueText(target), attempt(() => Object.defineProperty(target, "k", { value: noted("value", 1) })));
say("the descriptor was evaluated each time", order.join());
for (const descriptor of [1, "text", null, undefined, true, tag]) say("with the descriptor " + valueText(descriptor), attempt(() => describeKey(Object.defineProperty({}, "k", descriptor), "k")));

const reused = { value: "first", enumerable: true };
const firstHolder = Object.defineProperty({}, "k", reused);
reused.value = "second";
const secondHolder = Object.defineProperty({}, "k", reused);
say("one descriptor used twice", describeKey(firstHolder, "k") + " | " + describeKey(secondHolder, "k") + " | " + JSON.stringify(reused));

const retained = [];
function retainsDescriptor(object, key) {
  const descriptor = { value: 1 };
  retained.push(descriptor);
  return Object.defineProperty(object, key, descriptor);
}
say("a descriptor that escapes", describeKey(retainsDescriptor({}, "k"), "k") + " | " + JSON.stringify(retained));

function assignsMember(object, key) {
  const descriptor = { value: 1, enumerable: true };
  descriptor.writable = true;
  return Object.defineProperty(object, key, descriptor);
}
function assignsMemberUnseen(object, key) {
  const descriptor = hide({ value: 1, enumerable: true });
  hide(descriptor).writable = true;
  return Object.defineProperty(object, key, hide(descriptor));
}
say("a member that is assigned after the literal", run(assignsMember, () => ({}), "k") + " | " + run(assignsMemberUnseen, () => ({}), "k"));

order.length = 0;
const fromGetters = Object.defineProperty({}, "k", {
  get writable() { return noted("writable", true); },
  get value() { return noted("value", 1); },
  get configurable() { return noted("configurable", false); },
  get enumerable() { return noted("enumerable", true); },
});
say("members that are getters", describeKey(fromGetters, "k") + " | " + order.join());
order.length = 0;
const accessorFromGetters = Object.defineProperty({}, "k", {
  get set() { return noted("set", setter); },
  get get() { return noted("get", getter); },
});
say("get and set that are getters", describeKey(accessorFromGetters, "k") + " | " + order.join());

const inherited = { enumerable: true, value: "inherited" };
say("a spread in the descriptor", describeKey(Object.defineProperty({}, "k", { ...inherited, writable: true }), "k"));
say("a computed name in the descriptor", describeKey(Object.defineProperty({}, "k", { ["val" + "ue"]: "computed" }), "k"));
say("a prototype in the descriptor", describeKey(Object.defineProperty({}, "k", { __proto__: inherited, writable: true }), "k"));
say("unrelated members", describeKey(Object.defineProperty({}, "k", { value: 1, extra: 2, other() {} }), "k"));
function withFlags(flag) {
  return describeKey(Object.defineProperty({}, "k", { value: 1, writable: flag, enumerable: flag, configurable: flag }), "k");
}
say("attributes that are not booleans", [1, 0, "", "no", null, undefined, {}, NaN, tag].map(withFlags).join(" | "));
say("Reflect.defineProperty", [Reflect.defineProperty({}, "k", { value: 1 }), Reflect.defineProperty(Object.freeze({}), "k", { value: 1 }), attempt(() => Reflect.defineProperty({}, "k", { get: 1 })), attempt(() => Reflect.defineProperty(1, "k", { value: 1 }))].join(" | "));
say("Object.defineProperties and Object.create", keysOf(Object.defineProperties({}, { a: { value: 1 }, b: { get: getter, enumerable: true } })) + " | " + keysOf(Object.create(null, { a: { value: 1, enumerable: true } })));

// Plain Bun makes these changes. A compiled program locks its built-ins. Both print the same line.
function sameDescriptor(a, b) {
  if (!a || !b) return a === b;
  return a.value === b.value && a.get === b.get && a.set === b.set && a.writable === b.writable && a.enumerable === b.enumerable && a.configurable === b.configurable;
}
function onBuiltin(label, holder, key, define) {
  const before = Reflect.getOwnPropertyDescriptor(holder, key);
  let error;
  try {
    define(holder, key);
  } catch (caught) {
    error = caught;
  }
  const isUnchanged = sameDescriptor(before, Reflect.getOwnPropertyDescriptor(holder, key));
  if (!isUnchanged) attempt(() => (before ? Object.defineProperty(holder, key, before) : delete holder[key]));
  const isConsistent = error === undefined || (error instanceof TypeError && isUnchanged);
  say(label, isConsistent ? "defined, or a TypeError and no change" : "changed: " + !isUnchanged + ", " + error);
}
const holders = [
  ["Object.prototype", hide(Object.prototype), "propertyIsEnumerable"],
  ["Array.prototype", hide(Array.prototype), "at"],
  ["Function.prototype", hide(Function.prototype), "apply"],
  ["Map.prototype", hide(Map.prototype), "forEach"],
  ["Promise.prototype", hide(Promise.prototype), "finally"],
  ["Object", hide(Object), "entries"],
  ["Math", hide(Math), "hypot"],
  ["JSON", hide(JSON), "parse"],
  ["globalThis", hide(globalThis), "escape"],
];
for (const [label, holder, member] of holders) {
  onBuiltin(label + ", a new value", holder, "definedByThisTest", (object, key) => Object.defineProperty(object, key, { value: 1, writable: true, configurable: true }));
  onBuiltin(label + ", a new getter", holder, "definedByThisTest", (object, key) => Object.defineProperty(object, key, { get: getter, configurable: true }));
  onBuiltin(label + ", a new symbol", holder, tag, (object, key) => Object.defineProperty(object, key, { value: 1, configurable: true }));
  onBuiltin(label + "." + member + ", another value", holder, member, (object, key) => Object.defineProperty(object, key, { value: getter, writable: true, configurable: true }));
  onBuiltin(label + "." + member + ", a getter", holder, member, (object, key) => Object.defineProperty(object, key, { get: getter, configurable: true }));
  onBuiltin(label + "." + member + ", its current value", holder, member, (object, key) => Object.defineProperty(object, key, { value: object[key] }));
}

const comparedLabels = ["an absent name", "a data property", "a function", "a field of a class instance", "an undeclared name of a class instance"];
const comparedTargets = targets.filter(([label]) => comparedLabels.includes(label));
const wasStored = attempt(() => {
  hide(Object.prototype).get = getter;
  return "stored";
});
const isInherited = "get" in {};
const withInheritedGet = comparedTargets.map(([, create, key, read]) => compareWithVariables(create, key, read));
attempt(() => delete hide(Object.prototype).get);
say("Object.prototype.get is inherited exactly if the store succeeded", (wasStored === "stored") === isInherited);
say("and it was removed", !("get" in {}));
comparedTargets.forEach(([label], index) => say(label + ", after a store to Object.prototype.get", withInheritedGet[index]));

const assigned = [];
attempt(() => Object.defineProperty(hide(Object.prototype), "writable", { set(value) { assigned.push(value); }, configurable: true }));
const seenAssignment = run(assignsMember, () => ({}), "k");
const callsWhenSeen = assigned.length;
const unseenAssignment = run(assignsMemberUnseen, () => ({}), "k");
const callsWhenUnseen = assigned.length - callsWhenSeen;
attempt(() => delete hide(Object.prototype).writable);
say("a member assigned after the literal, after a setter was defined on Object.prototype", (seenAssignment === unseenAssignment) + " " + (callsWhenSeen === callsWhenUnseen));
say("and it was removed", !("writable" in {}));

console.log(lines.join("\n"));
