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

function score(record) {
  return [record.points * 2, record.points | 0, record.points + 1, record.points < 5];
}

function scoreOfAll(records) {
  let total = 0;
  for (let i = 0; i < records.length; i++) total += records[i].points;
  return total;
}

const source = '{"points":3}';
const list = '[{"points":1},{"points":2},{"points":3}]';
for (let i = 0; i < 2000; i++) {
  score(JSON.parse(source));
  scoreOfAll(JSON.parse(list));
}

const revivers = {
  "none": undefined,
  "to a text": (key, value) => (key === "points" ? String(value) : value),
  "to a fraction": (key, value) => (key === "points" ? value + 0.5 : value),
  "to a bigint": (key, value) => (key === "points" ? BigInt(value) : value),
  "to undefined": (key, value) => (key === "points" ? undefined : value),
  "to null": (key, value) => (key === "points" ? null : value),
  "to negative zero": (key, value) => (key === "points" ? -0 : value),
  "to 2 ** 31": (key, value) => (key === "points" ? 2147483648 : value),
  "to an object": (key, value) => (key === "points" ? { valueOf: () => value * 10 } : value),
  "to a date": (key, value) => (key === "points" ? new Date(value) : value),
  "to an array": (key, value) => (key === "points" ? [value] : value),
  "to NaN": (key, value) => (key === "points" ? NaN : value),
};

for (const name of Object.keys(revivers)) {
  attempt("score revived " + name, () => score(JSON.parse(source, revivers[name])));
  attempt("scoreOfAll revived " + name, () => scoreOfAll(JSON.parse(list, revivers[name])));
}

const originals = {
  "an integer": 3,
  "a fraction": 3.5,
  "negative zero": -0,
  "NaN": NaN,
  "a text": "3",
  "a bigint": 3n,
  "a Number object": new Number(3),
  "a date": new Date(3),
  "undefined": undefined,
  "an array": [3],
};
for (const name of Object.keys(originals)) attempt("score of a clone with " + name, () => score(structuredClone({ points: originals[name] })));
attempt("score of an honest record", () => score(JSON.parse(source)));
