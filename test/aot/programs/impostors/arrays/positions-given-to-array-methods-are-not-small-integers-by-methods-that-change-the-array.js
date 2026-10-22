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

const positions = {
  "0": 0,
  "1": 1,
  "-1": -1,
  "-0": -0,
  "4 (the length)": 4,
  "5": 5,
  "-4": -4,
  "-5": -5,
  "1.9": 1.9,
  "-1.9": -1.9,
  "0.5": 0.5,
  "-0.5": -0.5,
  NaN: NaN,
  infinity: Infinity,
  "minus infinity": -Infinity,
  "2 ** 31 - 1": 2 ** 31 - 1,
  "2 ** 31": 2 ** 31,
  "-(2 ** 31)": -(2 ** 31),
  "-(2 ** 31) - 1": -(2 ** 31) - 1,
  "2 ** 32": 2 ** 32,
  "2 ** 32 + 1": 2 ** 32 + 1,
  "-(2 ** 32) + 1": -(2 ** 32) + 1,
  "2 ** 53": 2 ** 53,
  "1e300": 1e300,
  "the text 1": "1",
  "the text -1": "-1",
  "a word": "one",
  "an empty text": "",
  null: null,
  undefined: undefined,
  true: true,
  "an array of 1": [1],
  "an object worth 1": { valueOf: () => 1 },
  "1n": 1n,
  "a symbol": Symbol("one"),
};

const uses = {
  spliceFrom: (list, position) => [list.splice(position, 1), list],
  spliceCount: (list, position) => [list.splice(1, position), list],
  spliceOnlyFrom: (list, position) => [list.splice(position), list],
  fillFrom: (list, position) => list.fill("f", position),
  fillTo: (list, position) => list.fill("f", 0, position),
  copyWithinTarget: (list, position) => list.copyWithin(position, 2),
  copyWithinStart: (list, position) => list.copyWithin(0, position),
  copyWithinEnd: (list, position) => list.copyWithin(0, 1, position),
  setLength(list, position) {
    list.length = position;
    return list.length;
  },
  sized: (list, position) => { const made = new Array(position); return [made.length, 0 in made]; },
  fromLength: (list, position) => { const length = Array.from({ length: typeof position === "number" && position > 9 ? 9 : position }).length; return length; },
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use](["a", "b", "c", "d"], i & 3);

for (const use in uses) for (const name in positions) attempt(use + ", " + name, () => uses[use](["a", "b", "c", "d"], positions[name]));
