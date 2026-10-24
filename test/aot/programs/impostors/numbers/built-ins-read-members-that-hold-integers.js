function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

const { inspect, isDeepStrictEqual } = require("util");

class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
  shift() {
    this.x = this.x + 1;
    this.y = this.y - 1;
    return this;
  }
}

function Size(width, height) {
  this.width = width;
  this.height = height;
}

function makePair(first, second) {
  return { first, second };
}

const readers = {
  "Object.values": holder => Object.values(holder),
  "Object.entries": holder => Object.entries(holder),
  "JSON.stringify": holder => JSON.stringify(holder),
  "JSON.stringify with a list of names": holder => JSON.stringify(holder, Object.keys(holder).slice(1)),
  "a spread": holder => ({ ...holder }),
  "Object.assign": holder => Object.assign({}, holder),
  "structuredClone": holder => structuredClone({ ...holder }),
  "for-in": holder => {
    const seen = [];
    for (const key in holder) seen.push(key, holder[key]);
    return seen;
  },
  "descriptors": holder => Object.values(Object.getOwnPropertyDescriptors(holder)).map(descriptor => [descriptor.value, descriptor.writable, descriptor.enumerable, descriptor.configurable]),
  "Reflect.get": holder => Reflect.ownKeys(holder).map(key => Reflect.get(holder, key)),
  "inspect": holder => inspect(holder),
  "Bun.inspect": holder => Bun.inspect(holder),
  "isDeepStrictEqual with a copy": holder => isDeepStrictEqual({ ...holder }, Object.assign({}, holder)),
  "Bun.deepEquals with a copy": holder => Bun.deepEquals({ ...holder }, Object.fromEntries(Object.entries(holder))),
  "a Map of the entries": holder => [...new Map(Object.entries(holder)).values()],
  "Math.max of the values": holder => Math.max(...Object.values(holder)),
  "a template": holder => `${Object.values(holder)}`,
  "a destructuring with a rest": holder => {
    const { ...rest } = holder;
    return rest;
  },
};

let total = 0;
for (let i = 0; i < 2000; i++) total += new Point(i, 1).shift().x + new Size(i, 2).width + makePair(i, 3).first;
console.log("the honest total", total);

const pairs = [[1, 2], [2147483647, -2147483648], [-2147483647, -2147483646]];
const late = JSON.parse('[[0.5, 2], ["1", 2], [null, 2], [2147483648, -2147483649], [-0, 1e21]]').concat([[-0, NaN], [undefined, 1n]]);
for (const name of Object.keys(readers)) {
  for (const [a, b] of pairs) {
    attempt(name + " of a Point of " + a + " and " + b, () => readers[name](new Point(a, b)));
    attempt(name + " of a Size of " + a + " and " + b, () => readers[name](new Size(a, b)));
    attempt(name + " of a pair of " + a + " and " + b, () => readers[name](makePair(a, b)));
  }
  for (const [a, b] of late) {
    attempt(name + " of a Point that got " + show(a) + " and " + show(b), () => {
      const point = new Point(1, 2);
      for (const [key, value] of [["x", a], ["y", b]]) point[key] = value;
      return readers[name](point);
    });
  }
  attempt(name + " of a Point past the largest int32", () => readers[name](new Point(2147483647, -2147483648).shift()));
}
