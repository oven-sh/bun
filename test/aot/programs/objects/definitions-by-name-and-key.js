// Own properties that are defined, not assigned: computed keys in object literals and class fields, on ordinary, frozen, non-extensible, Proxy, array, function, class, error and Map targets. A computed key is converted before its value is evaluated, as ECMAScript says; plain Bun converts it afterwards.
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
  if (!descriptor) return keyText(key) + " absent";
  const flags = (descriptor.writable ? "w" : "-") + (descriptor.enumerable ? "e" : "-") + (descriptor.configurable ? "c" : "-");
  const body = "value" in descriptor ? valueText(descriptor.value) : (descriptor.get ? "get" : "") + (descriptor.set ? "set" : "");
  return keyText(key) + " " + flags + " " + body;
}
function describe(object) {
  return Reflect.ownKeys(object)
    .map(key => describeKey(object, key))
    .join(", ");
}
function attempt(action) {
  try {
    return action();
  } catch (error) {
    return error.name + ": " + error.message;
  }
}

const tag = Symbol("tag");

function literal(text, number, i) {
  return { first: i, [text]: i + 1, [tag]: i + 2, [number]: i + 3, ["__proto__"]: i + 4, last: i + 5 };
}
say("computed keys", describe(literal("middle", 7, 10)));
say("a computed __proto__ does not set the prototype", Object.getPrototypeOf(literal("middle", 7, 10)) === Object.prototype);

function repeated(key, i) {
  return { a: i, [key]: i + 1, b: i + 2, [key]: i + 3, c: i + 4 };
}
for (const key of ["k", "a", "b", "c", tag, 3, "3", "__proto__"]) say("defined twice, " + keyText(key), describe(repeated(key, 0)));

function between(key) {
  return { before: 0, [key]: "here", after: 1 };
}
const keyKinds = [
  0, -0, 1, 1.5, -1, 4294967294, 4294967295, 4294967296, 1e21, 1e-7, NaN, Infinity, true, null, undefined, 10n, "", "a b", [1, 2],
  { toString() { return "from toString"; } },
  { [Symbol.toPrimitive]() { return tag; } },
  Symbol.iterator, Symbol.for("registered"), Symbol(),
];
keyKinds.forEach((key, index) => say("key kind " + index, describe(between(key))));

const order = [];
function keyNamed(name) {
  return { toString() { order.push("key " + name); return name; } };
}
function noted(value) {
  order.push("value " + value);
  return value;
}
const ordered = { [keyNamed("x")]: noted(1), [keyNamed("y")]: noted(2), [keyNamed("x")]: noted(3) };
say("each key is converted before its value is evaluated", order.join(", ") + " | " + describe(ordered));
order.length = 0;
const thrown = attempt(() => describe({ a: noted("a"), [{ toString() { throw new RangeError("no key"); } }]: noted("never"), b: noted("never either") }));
say("a key that throws", thrown + " | " + order.join(", "));

const names = ["alpha", "beta", "gamma", "delta"];
const orders = new Set();
let total = 0;
for (let i = 0; i < 100; i++) {
  const text = names[i % names.length];
  const object = literal(text, i % 2, i);
  orders.add(Reflect.ownKeys(object).map(keyText).join());
  total += object.first + object[text] + object[tag] + object[i % 2] + object["__proto__"] + object.last;
}
say("constant strings as keys, 100 literals", total + " | " + [...orders].sort().join(" | "));

orders.clear();
total = 0;
for (let i = 0; i < 100; i++) {
  const built = "built" + (i % 3);
  const object = { [built]: i, [`templated${i % 2}`]: i + 1, [built + "!"]: i + 2, [String(i % 2)]: i + 3 };
  orders.add(Reflect.ownKeys(object).map(keyText).join());
  total += object[built] + object["templated" + (i % 2)] + object[built + "!"] + object[i % 2];
}
say("strings built at run time as keys, 100 literals", total + " | " + [...orders].sort().join(" | "));

function classWith(first, second) {
  return class {
    before = "before";
    [first] = "first";
    [second] = "second";
    after = "after";
    static [first] = "static first";
    static [second] = "static second";
  };
}
const fieldKeys = [["one", "two"], ["same", "same"], ["before", "after"], ["after", "before"], [tag, Symbol.for("registered")], [1, 0], ["__proto__", "constructor"], ["name", "length"]];
for (const [first, second] of fieldKeys) {
  const WithFields = classWith(first, second);
  let last;
  for (let i = 0; i < 100; i++) last = new WithFields();
  say("fields " + keyText(first) + " and " + keyText(second), describe(last) + " | static: " + describeKey(WithFields, first) + ", " + describeKey(WithFields, second));
}

class Returns {
  constructor(target) {
    return target;
  }
}
class DefinesAlpha extends Returns {
  alpha = "by name";
}
function definerOf(key) {
  return class extends Returns {
    [key] = "by key";
  };
}
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
const targetKeys = ["alpha", "x", tag, 0, 5, "length", "__proto__"];
const definers = new Map(targetKeys.map(key => [key, definerOf(key)]));
function define(definer, target) {
  return attempt(() => {
    new definer(target);
    return "defined";
  });
}
const targets = [
  ["an empty object", () => ({})],
  ["an object with the property", () => ({ alpha: "old", omega: "old" })],
  ["a frozen object", () => Object.freeze({ alpha: "old" })],
  ["a sealed object", () => Object.seal({ alpha: "old" })],
  ["a non-extensible object", () => Object.preventExtensions({ alpha: "old" })],
  ["a read-only property", () => Object.defineProperty({}, "alpha", { value: "old", configurable: true })],
  ["a getter", () => ({ get alpha() { return "old"; } })],
  ["an object without a prototype", () => Object.create(null)],
  ["a class instance", () => new Point(1, 2)],
  ["a frozen class instance", () => Object.freeze(new Point(1, 2))],
  ["a non-extensible class instance", () => Object.preventExtensions(new Point(1, 2))],
  ["an array", () => ["old", "old"]],
  ["a frozen array", () => Object.freeze(["old", "old"])],
  ["a typed array", () => new Uint8Array(2)],
];
for (const [label, create] of targets) {
  const named = create();
  say(label + ", alpha by name", define(DefinesAlpha, named) + " | " + describe(named));
  for (const key of targetKeys) {
    const target = create();
    say(label + ", " + keyText(key), define(definers.get(key), target) + " | " + describe(target));
  }
}

const otherKeys = ["alpha", tag, "name", "length", "prototype", "displayName", "declared", "message", "stack"];
const otherDefiners = new Map(otherKeys.map(key => [key, definerOf(key)]));
const otherTargets = [
  ["a function", () => function target() {}],
  ["an arrow function", () => () => {}],
  ["a bound function", () => function target() {}.bind(null)],
  ["a class", () => class Target { static declared = "old"; }],
  ["an error", () => new RangeError("old")],
  ["a Map", () => new Map()],
];
for (const [label, create] of otherTargets) {
  for (const key of otherKeys) {
    const target = create();
    say(label + ", " + keyText(key), define(otherDefiners.get(key), target) + " | " + describeKey(target, key) + " | " + Object.keys(target).join());
  }
}

function watched(target, allows) {
  const log = [];
  const proxy = new Proxy(target, {
    defineProperty(inner, key, descriptor) {
      log.push("defineProperty " + keyText(key) + " " + JSON.stringify(descriptor));
      return allows && Reflect.defineProperty(inner, key, descriptor);
    },
    set(inner, key) {
      log.push("set " + keyText(key));
      return true;
    },
    getOwnPropertyDescriptor(inner, key) {
      log.push("getOwnPropertyDescriptor " + keyText(key));
      return Reflect.getOwnPropertyDescriptor(inner, key);
    },
  });
  return { proxy, log };
}
for (const allows of [true, false]) {
  const label = allows ? "a Proxy whose trap succeeds" : "a Proxy whose trap returns false";
  const inner = { alpha: "old" };
  const { proxy, log } = watched(inner, allows);
  say(label + ", alpha by name", define(DefinesAlpha, proxy) + " | " + log.join("; "));
  for (const key of targetKeys) {
    log.length = 0;
    say(label + ", " + keyText(key), define(definers.get(key), proxy) + " | " + log.join("; "));
  }
  say(label + ", its target", describe(inner));
}

const extraDefiners = ["extra", "more", tag, "y"].map(definerOf);
total = 0;
orders.clear();
for (let i = 0; i < 100; i++) {
  const point = new Point(i, -i);
  for (const definer of extraDefiners) new definer(point);
  orders.add(describe(point).replaceAll(String(i), "i"));
  total += point.x + point.extra.length + point.more.length + point[tag].length + point.y.length;
}
say("undeclared names on 100 class instances", total + " | " + [...orders].join(" | "));

const calls = [];
const parent = {
  set watched(value) {
    calls.push(value);
  },
  get watched() {
    return "inherited";
  },
};
Object.defineProperty(parent, "fixed", { value: "inherited", enumerable: true });
function definedOver(key, value) {
  return { __proto__: parent, [key]: value };
}
function assignedOver(key, value) {
  "use strict";
  const object = { __proto__: parent };
  object[key] = value;
  return object;
}
let ownAfterDefinition = 0;
let ownAfterAssignment = 0;
for (let i = 0; i < 100; i++) {
  if (Object.hasOwn(definedOver("watched", i), "watched")) ownAfterDefinition++;
  if (Object.hasOwn(assignedOver("watched", i), "watched")) ownAfterAssignment++;
}
say("over an inherited setter", ownAfterDefinition + " definitions created an own property, " + ownAfterAssignment + " assignments did, the setter ran " + calls.length + " times");
say("over an inherited read-only property, defined", describe(definedOver("fixed", 1)));
say("over an inherited read-only property, assigned", attempt(() => describe(assignedOver("fixed", 1))));
say("no inherited property, defined and assigned", describe(definedOver("free", 1)) + " | " + describe(assignedOver("free", 1)));

calls.length = 0;
class Watches {
  set watched(value) {
    calls.push("watched " + value);
  }
  set [tag](value) {
    calls.push("tag " + value);
  }
}
class DefinesOverSetters extends Watches {
  watched = 1;
  [tag] = 2;
}
class AssignsToSetters extends Watches {
  constructor() {
    super();
    this.watched = 1;
    this[tag] = 2;
  }
}
say("fields over inherited setters", describe(new DefinesOverSetters()) + " | " + calls.join(", "));
say("assignments to inherited setters", describe(new AssignsToSetters()) + " | " + calls.join(", "));

console.log(lines.join("\n"));
