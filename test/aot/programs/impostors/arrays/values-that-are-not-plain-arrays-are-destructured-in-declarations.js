function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, list, run) {
  try {
    console.log(label + ": " + describe(run(list)));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name + " and left " + describe(list));
  }
}

class Quiet extends Array {}

class Loud extends Array {
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const ownMembers = {
  *[Symbol.iterator]() {
    yield "its own iterator";
  },
};

const otherPrototype = {
  __proto__: Array.prototype,
  *[Symbol.iterator]() {
    yield "the other prototype's iterator";
  },
};

const makers = {
  "null": () => null,
  "undefined": () => undefined,
  "a number": () => 312,
  "a function": () => function (a, b, c) {},
  "an empty object": () => ({}),
  "a subclass": () => Quiet.of(3, 1, 2),
  "a subclass that overrides": () => Loud.of(3, 1, 2),
  "an array-like": () => ({ 0: 3, 1: 1, 2: 2, length: 3 }),
  "an array-like under Array.prototype": () => ({ __proto__: Array.prototype, 0: 3, 1: 1, 2: 2, length: 3 }),
  "an array with its own member": () => Object.assign([3, 1, 2], ownMembers),
  "an array under null": () => Object.setPrototypeOf([3, 1, 2], null),
  "an array under another prototype": () => Object.setPrototypeOf([3, 1, 2], otherPrototype),
  "a proxy": () => new Proxy([3, 1, 2], {}),
  "mapped arguments": () => (function (a, b, c) { return arguments; })(3, 1, 2),
  "unmapped arguments": () => (function () { "use strict"; return arguments; })(3, 1, 2),
  "a Uint8Array": () => new Uint8Array([3, 1, 2]),
  "a Float64Array": () => new Float64Array([3.5, 1, 2]),
  "a BigInt64Array": () => new BigInt64Array([3n, 1n, 2n]),
  "a string": () => "312",
  "a String object": () => new String("312"),
  "a Set": () => new Set([3, 1, 2]),
  "a Map": () => new Map([[3, "c"], [1, "a"], [2, "b"]]),
  "a generator": () => (function* () { yield 3; yield 1; yield 2; })(),
  "a frozen array": () => Object.freeze([3, 1, 2]),
  "a sealed array": () => Object.seal([3, 1, 2]),
  "a non-extensible array": () => Object.preventExtensions([3, 1, 2]),
  "an array with a hole": () => [3, , 2],
  "a hole over an inherited element": () => Object.setPrototypeOf([3, , 2], { __proto__: Array.prototype, 1: "inherited" }),
  "an array with a getter": () => Object.defineProperty([3, 1, 2], 1, { get() { return "got"; }, enumerable: true, configurable: true }),
  "an array with a fixed length": () => Object.defineProperty([3, 1, 2], "length", { writable: false }),
  "a sparse array": () => { const list = [3, 1, 2]; list[20000] = 4; return list; },
  "doubles": () => [3.5, 1.25, 2],
  "strings": () => ["c", "a", "b"],
  "mixed values": () => [3, "1", 2.5, null, undefined, { valueOf() { return 7; } }],
  "an empty array": () => [],
  "an array": () => [3, 1, 2],
};

function four(list) {
  const [a, b, c, d] = list;
  return [a, b, c, d];
}

function withDefaults(list) {
  const [a = "default a", b = "default b", c = "default c", d = "default d"] = list;
  return [a, b, c, d];
}

function secondOnly(list) {
  const [, second] = list;
  return second;
}

function headAndTail(list) {
  const [head, ...tail] = list;
  return [head, tail];
}

const uses = {
  "four": list => four(list),
  "defaults": list => withDefaults(list),
  "second": list => secondOnly(list),
  "head and tail": list => headAndTail(list),
};

const honest = {};

function round(title) {
  for (const name in makers) {
    for (const use in uses) {
      attempt(title + ", " + use + ", " + name, makers[name](), uses[use]);
      if (Object.hasOwn(honest, use) && describe(uses[use]([3, 1, 2])) !== honest[use]) console.log("WRONG: an array after " + name + " in " + use);
    }
  }
}

round("at first");
for (const use in uses) {
  honest[use] = describe(uses[use]([3, 1, 2]));
  for (let i = 0; i < 2000; i++) uses[use]([3, 1, 2]);
}
round("after 2000 arrays");

module.exports = uses;
