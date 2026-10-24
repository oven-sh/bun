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
  joined: (a, b) => [a, b].join("-"),
  text: (a, b) => String([a, b]),
  walked(a, b) {
    let text = "";
    for (const value of [a, b]) text += typeof value + " ";
    return text;
  },
  mapped: (a, b) => [a, b].map(value => typeof value),
  filtered: (a, b) => [a, b].filter(Boolean).length,
  sorted: (a, b) => [a, b, 10, 9].sort().map(String),
  sortedByNumber: (a, b) => [a, b, 10, 9].sort((x, y) => x - y).map(String),
  some: (a, b) => [a, b].some(value => value === undefined),
  every: (a, b) => [a, b].every(value => value == null),
  reduced: (a, b) => [a, b].reduce((total, value) => total + value),
  flat: (a, b) => [a, [b]].flat().length,
  concat: (a, b) => [].concat(a, b).length,
  json: (a, b) => JSON.stringify([a === undefined || typeof a === "bigint" || typeof a === "symbol" ? "skipped" : a, typeof b]),
  set: (a, b) => new Set([a, b, a]).size,
  entries: (a, b) => Object.fromEntries([["a", typeof a], ["b", typeof b]]),
};

const values = {
  "1": 1,
  "0": 0,
  "-0": -0,
  NaN: NaN,
  "1.5": 1.5,
  "the text 1": "1",
  "an empty text": "",
  undefined: undefined,
  null: null,
  true: true,
  "1n": 1n,
  "an object": { valueOf: () => 1 },
  "an array": [1],
  "a symbol": Symbol("one"),
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use](i & 1, 1);

for (const use in uses) {
  const answers = [];
  for (const name in values) {
    for (const [a, b] of [[values[name], 1], [1, values[name]], [values[name], values[name]]]) {
      try {
        answers.push(describe(uses[use](a, b)));
      } catch (error) {
        answers.push(error.constructor.name);
      }
    }
    console.log(use + ", " + name + " first, second, both: " + answers.splice(0).join(" | "));
  }
}
