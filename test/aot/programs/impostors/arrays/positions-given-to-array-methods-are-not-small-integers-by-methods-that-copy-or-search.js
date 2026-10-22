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
  sliceFrom: (list, position) => list.slice(position),
  sliceTo: (list, position) => list.slice(0, position),
  sliceBoth: (list, position) => list.slice(position, position),
  at: (list, position) => list.at(position),
  withCopy: (list, position) => list.with(position, "w"),
  indexOfFrom: (list, position) => list.indexOf("c", position),
  lastIndexOfFrom: (list, position) => list.lastIndexOf("b", position),
  includesFrom: (list, position) => list.includes("c", position),
  toSplicedFrom: (list, position) => list.toSpliced(position, 1),
  toSplicedCount: (list, position) => list.toSpliced(1, position),
  flatDepth: (list, position) => [list, [[list[0]]]].flat(position).length,
};

for (const use in uses) for (let i = 0; i < 1000; i++) uses[use](["a", "b", "c", "d"], i & 3);

for (const use in uses) for (const name in positions) attempt(use + ", " + name, () => uses[use](["a", "b", "c", "d"], positions[name]));
