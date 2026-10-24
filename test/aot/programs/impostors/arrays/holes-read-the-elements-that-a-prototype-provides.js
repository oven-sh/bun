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

class Backed extends Array {}
Backed.prototype[1] = "from the class";
Backed.prototype[4] = "past the end";

const backing = { __proto__: Array.prototype, 1: "from the object" };
const deepBacking = { __proto__: { __proto__: Array.prototype, 1: "from two levels up" } };
const reads = [];
const countingBacking = {
  __proto__: Array.prototype,
  get 1() {
    reads.push("read");
    return "from a getter";
  },
};

const makers = {
  "a hole": () => [3, , 2],
  "a hole in a subclass with elements on its prototype": () => { const list = new Backed(3); list[0] = 3; list[2] = 2; return list; },
  "a hole over an object": () => Object.setPrototypeOf([3, , 2], backing),
  "a hole over two levels": () => Object.setPrototypeOf([3, , 2], deepBacking),
  "a hole over a getter": () => Object.setPrototypeOf([3, , 2], countingBacking),
  "a deleted element over an object": () => { const list = Object.setPrototypeOf([3, 1, 2], backing); delete list[1]; return list; },
  "a hole in doubles over an object": () => Object.setPrototypeOf([3.5, , 2.5], backing),
  "a grown length over an object": () => { const list = Object.setPrototypeOf([3], backing); list.length = 3; return list; },
  "an array over another array": () => Object.setPrototypeOf([3, , 2], ["zero", "from an array", "two", "three"]),
  "undefined instead of a hole": () => [3, undefined, 2],
};

const uses = {
  byIndex(list) {
    const seen = [];
    for (let i = 0; i < list.length; i++) seen.push(list[i]);
    return seen;
  },
  second: list => list[1],
  pastTheEnd: list => [list[4], list[list.length]],
  has: list => [1 in list, Object.hasOwn(list, 1), 4 in list],
  forOf(list) {
    const seen = [];
    for (const value of list) seen.push(value);
    return seen;
  },
  spread: list => [...list],
  pattern(list) {
    const [a, b = "default", c] = list;
    return [a, b, c];
  },
  forEach(list) {
    const seen = [];
    list.forEach((value, index) => seen.push(index, value));
    return seen;
  },
  map: list => Array.from(list.map(value => "<" + value + ">")),
  mapKeepsHoles: list => 1 in list.map(value => value),
  filter: list => Array.from(list.filter(() => true)),
  reduce: list => list.reduce((text, value) => text + "|" + value, ""),
  some: list => list.some(value => typeof value === "string"),
  find: list => list.find((value, index) => index === 1),
  indexOf: list => [list.indexOf(undefined), list.indexOf("from the object"), list.includes(undefined), list.includes("from the object")],
  join: list => list.join(),
  slice: list => { const copy = list.slice(); return [Object.hasOwn(copy, 1), copy[1]]; },
  concat: list => { const copy = [].concat(list); return [Object.hasOwn(copy, 1), copy[1]]; },
  flat: list => [list].flat().length,
  reverse: list => { list.reverse(); return [Object.hasOwn(list, 1), list[0], list[1], list[2]]; },
  sort: list => { list.sort(); return [Object.hasOwn(list, 0), Object.hasOwn(list, 1), Object.hasOwn(list, 2), list[0], list[1], list[2]]; },
  shift: list => [list.shift(), Object.hasOwn(list, 0), list[0], list[1], list.length],
  popTwice: list => [list.pop(), list.pop(), list.length],
  keys: list => Object.keys(list),
  forIn(list) {
    const seen = [];
    for (const key in list) seen.push(key);
    return seen;
  },
  json: list => JSON.stringify(list),
  from: list => Array.from(list),
  storeIntoTheHole: list => { list[1] = "stored"; return [Object.hasOwn(list, 1), list[1]]; },
  addToTheHole: list => { list[1] += "!"; return [Object.hasOwn(list, 1), list[1]]; },
};

function round(title) {
  for (const name in makers) {
    for (const use in uses) {
      reads.length = 0;
      attempt(title + ", " + use + ", " + name, () => uses[use](makers[name]()));
      if (reads.length) console.log("  the getter ran " + reads.length + " times");
    }
  }
}

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([3, 1, 2]);
round("after 1000 arrays");
