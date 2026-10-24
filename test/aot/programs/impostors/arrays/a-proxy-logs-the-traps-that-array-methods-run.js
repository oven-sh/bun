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

const log = [];

function note(trap, key) {
  log.push(trap + " " + String(key));
}

const handler = {
  get(target, key, receiver) {
    note("get", key);
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    note("set", key);
    return Reflect.set(target, key, value, receiver);
  },
  has(target, key) {
    note("has", key);
    return Reflect.has(target, key);
  },
  deleteProperty(target, key) {
    note("delete", key);
    return Reflect.deleteProperty(target, key);
  },
  defineProperty(target, key, descriptor) {
    note("define", key);
    return Reflect.defineProperty(target, key, descriptor);
  },
  getOwnPropertyDescriptor(target, key) {
    note("describe", key);
    return Reflect.getOwnPropertyDescriptor(target, key);
  },
};

const uses = {
  push: list => list.push(9),
  pop: list => list.pop(),
  shift: list => list.shift(),
  unshift: list => list.unshift(9),
  splice: list => list.splice(1, 1),
  slice: list => list.slice(1),
  concat: list => list.concat([9]),
  givenToConcat: list => [9].concat(list),
  sort: list => list.sort() === list,
  reverse: list => list.reverse() === list,
  fill: list => list.fill(0) === list,
  copyWithin: list => list.copyWithin(0, 1) === list,
  map: list => list.map(value => value * 2),
  filter: list => list.filter(value => value > 1),
  forEach: list => list.forEach(value => value),
  reduce: list => list.reduce((total, value) => total + value, 0),
  find: list => list.find(value => value === 1),
  findLast: list => list.findLast(value => value === 1),
  indexOf: list => list.indexOf(2),
  lastIndexOf: list => list.lastIndexOf(3),
  includes: list => list.includes(2),
  join: list => list.join("-"),
  flat: list => list.flat(),
  flatMap: list => list.flatMap(value => [value]),
  at: list => list.at(-1),
  keys: list => [...list.keys()],
  values: list => [...list.values()],
  entries: list => [...list.entries()].length,
  every: list => list.every(value => value > 0),
  some: list => list.some(value => value > 2),
  toSorted: list => list.toSorted(),
  toReversed: list => list.toReversed(),
  with: list => list.with(1, 9),
  toSpliced: list => list.toSpliced(1, 1),
};

function round(title) {
  for (const use in uses) {
    log.length = 0;
    const target = [3, 1, 2];
    attempt(title + ", " + use, () => uses[use](new Proxy(target, handler)));
    console.log("  traps: " + log.join(", "));
    console.log("  target: " + describe(target));
  }
}

round("at first");
for (const use in uses) for (let i = 0; i < 2000; i++) uses[use]([3, 1, 2]);
round("after 2000 arrays");
