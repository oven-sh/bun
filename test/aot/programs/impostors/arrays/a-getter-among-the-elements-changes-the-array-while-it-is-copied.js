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

const uses = {
  spread: list => [...list],
  spreadBetween: list => ["before", ...list, "after"],
  spreadTwice: list => [...list, ...list],
  spreadIntoACall: list => ((...values) => values)(...list),
  pushAll(list) {
    const out = ["start"];
    out.push(...list);
    return out;
  },
  concat: list => [].concat(list),
  ownConcat: list => list.concat(["end"]),
  slice: list => list.slice(),
  from: list => Array.from(list),
  walk(list) {
    const seen = [];
    for (const value of list) {
      seen.push(value);
      if (seen.length === 10) break;
    }
    return seen;
  },
  byIndex(list) {
    const seen = [];
    for (let i = 0; i < list.length && i < 10; i++) seen.push(list[i]);
    return seen;
  },
  rest(list) {
    const [first, ...others] = list;
    return [first, others];
  },
  map: list => list.map(value => value),
  filter: list => list.filter(() => true),
  join: list => list.join(),
  json: list => JSON.stringify(list),
  toSorted: list => list.toSorted(),
  toReversed: list => list.toReversed(),
  flat: list => [list, list].flat(),
  values: list => Object.values(list),
  assign: list => Object.assign([], list),
  set: list => [...new Set(list)],
  apply: list => ((...values) => values).apply(null, list),
  includes: list => list.includes("pushed"),
  reduce: list => list.reduce((text, value) => text + "|" + value, ""),
};

const changes = {
  "pushes two": list => { list.push("pushed", "pushed too"); },
  "pops": list => { list.pop(); },
  "shrinks to two": list => { list.length = 2; },
  "empties": list => { list.length = 0; },
  "deletes the next": list => { delete list[2]; },
  "stores to the next": list => { list[2] = "stored"; },
  "stores a double to the next": list => { list[2] = 0.5; },
  "becomes a plain element": list => { Object.defineProperty(list, 1, { value: "plain", writable: true }); },
  "shifts": list => { list.shift(); },
  "reverses": list => { Object.defineProperty(list, 1, { value: "plain", writable: true }); list.reverse(); },
};

function make(change) {
  const list = [1, 2, 3, 4];
  let calls = 0;
  Object.defineProperty(list, 1, {
    get() {
      if (calls++ === 0) change(list);
      return "got";
    },
    enumerable: true,
    configurable: true,
  });
  return list;
}

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use]([1, 2, 3, 4]);

for (const use in uses) for (const change in changes) attempt(use + ", the getter " + change, () => uses[use](make(changes[change])));
