// Arrays from another realm go where arrays went.
const vm = require("node:vm");

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

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

const makers = {
  "an array": "[3, 1, 2]",
  "doubles": "[3.5, 1.5, 2.5]",
  "an array with a hole": "[3, , 2]",
  "an array of holes": "new Array(3)",
  "a hole over that realm's Array.prototype": "Array.prototype[1] = 'inherited'; [3, , 2]",
  "a hole over that realm's Object.prototype": "Object.prototype[1] = 'inherited'; [3, , 2]",
  "an array whose realm replaced push": "Array.prototype.push = function () { return 'replaced push'; }; [3, 1, 2]",
  "an array whose realm replaced map": "Array.prototype.map = function () { return 'replaced map'; }; [3, 1, 2]",
  "an array whose realm replaced the iterator": "Array.prototype[Symbol.iterator] = function* () { yield 'replaced iterator'; }; [3, 1, 2]",
  "an array whose realm replaced next": "Object.getPrototypeOf([][Symbol.iterator]()).next = function () { return { done: true }; }; [3, 1, 2]",
  "an array whose realm has a setter at 3": "Object.defineProperty(Array.prototype, 3, { set(value) { this.caught = value; }, configurable: true }); [3, 1, 2]",
  "a subclass": "class Loud extends Array { push() { return 'the subclass push'; } } Loud.of(3, 1, 2)",
  "a frozen array": "Object.freeze([3, 1, 2])",
  "a typed array": "new Uint8Array([3, 1, 2])",
  "arguments": "(function () { return arguments; })(3, 1, 2)",
  "a Set": "new Set([3, 1, 2])",
  "an array-like": "({ 0: 3, 1: 1, 2: 2, length: 3 })",
  "a proxy": "new Proxy([3, 1, 2], {})",
};

const uses = {
  checks: list => [Array.isArray(list), list instanceof Array, list.constructor === Array, Object.getPrototypeOf(list) === Array.prototype, Object.prototype.toString.call(list)],
  push: list => [list.push(9), list.length, Object.keys(list).join()],
  append(list) {
    list[list.length] = 9;
    return [list.length, Object.keys(list).join()];
  },
  sum(list) {
    let total = 0;
    for (let i = 0; i < list.length; i++) total += list[i];
    return total;
  },
  walk(list) {
    const seen = [];
    for (const value of list) seen.push(value);
    return seen;
  },
  copy: list => [...list],
  firstTwo(list) {
    const [a, b = "default"] = list;
    return [a, b];
  },
  map(list) {
    const result = list.map(value => value * 2);
    return [result instanceof Array, Array.from(result)];
  },
  ourMap(list) {
    const result = Array.prototype.map.call(list, value => value * 2);
    return [result instanceof Array, result];
  },
  ourSlice(list) {
    const result = Array.prototype.slice.call(list);
    return [result instanceof Array, 1 in result, result.length];
  },
  filter: list => Array.from(list.filter(value => value > 1)),
  sort: list => Array.from(list.sort((a, b) => a - b)),
  concat: list => [0].concat(list),
  flat: list => [list].flat(),
  from: list => Array.from(list),
  json: list => JSON.stringify(list),
  largest: list => Math.max(...list),
  applied: list => Math.max.apply(null, list),
  has: list => [1 in list, Object.hasOwn(list, 1), list.includes(undefined)],
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([3, 1, 2]);

for (const name in makers) {
  for (const use in uses) attempt(name + ", " + use, () => uses[use](vm.runInNewContext(makers[name])));
}

for (const use in uses) attempt("an array of this realm, " + use, () => uses[use]([3, 1, 2]));
attempt("this realm's holes are still empty", () => [[3, , 2][1], 1 in [3, , 2], [3, 1, 2].push(9)]);
