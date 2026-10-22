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

const shared = { name: "shared" };
const sharedSymbol = Symbol("shared");
const half = ["a"].join("");

const needles = {
  "2": 2,
  "1.5": 1.5,
  "0": 0,
  "-0": -0,
  NaN: NaN,
  "2 ** 31": 2 ** 31,
  infinity: Infinity,
  "the text 2": "2",
  "the text ab": "ab",
  "the text ab, concatenated": half + "b",
  "an empty text": "",
  "a String object": new String("ab"),
  "2n": 2n,
  "2n, computed": BigInt(1) + 1n,
  undefined: undefined,
  null: null,
  true: true,
  "the shared object": shared,
  "an object that looks the same": { name: "shared" },
  "the shared symbol": sharedSymbol,
  "an object with valueOf": { valueOf: () => 2 },
};

const lists = {
  integers: () => [1, 2, 3, 0, 2],
  doubles: () => [1.5, 2, NaN, -0, 2.5],
  "large numbers": () => [2 ** 31, Infinity, -Infinity, 2 ** 53],
  strings: () => ["ab", "2", "", "a" + half.slice(1) + "b"],
  "mixed values": () => [2n, null, undefined, true, shared, sharedSymbol, "2", 2],
  "integers with a hole": () => [1, , 2],
  "doubles with a hole": () => [1.5, , 2],
  "only holes": () => new Array(3),
  empty: () => [],
  "a typed array": () => new Float64Array([1.5, 2, NaN, -0]),
  "a typed array of integers": () => new Int32Array([1, 2, 3, 0, 2]),
  "a typed array of big integers": () => new BigInt64Array([2n, 0n]),
};

function placeOf(list, value) {
  return list.indexOf(value);
}

function lastPlaceOf(list, value) {
  return list.lastIndexOf(value);
}

function has(list, value) {
  return list.includes(value);
}

function byLoop(list, value) {
  for (let i = 0; i < list.length; i++) if (list[i] === value) return i;
  return -1;
}

function byFind(list, value) {
  return list.findIndex(element => Object.is(element, value));
}

for (let i = 0; i < 2000; i++) {
  placeOf([1, 2, 3], i & 3);
  lastPlaceOf([1, 2, 3], i & 3);
  has([1, 2, 3], i & 3);
  byLoop([1, 2, 3], i & 3);
  byFind([1, 2, 3], i & 3);
}

for (const list in lists) {
  for (const needle in needles) {
    const value = needles[needle];
    console.log(list + ", " + needle + ": " + [placeOf(lists[list](), value), lastPlaceOf(lists[list](), value), has(lists[list](), value), byLoop(lists[list](), value), byFind(lists[list](), value)].join(" "));
  }
}

const starts = [0, 1, -1, -2, 4, 5, 6, -5, -6, 1.9, -1.9, -0, NaN, Infinity, -Infinity, "1", null, undefined, true];
for (const start of starts) {
  const list = [1, 2, 3, 0, 2];
  console.log("from " + describe(start) + ": " + [list.indexOf(2, start), list.lastIndexOf(2, start), list.includes(2, start)].join(" "));
}
attempt("from a big integer", () => [1, 2].indexOf(2, 1n));
attempt("from a symbol", () => [1, 2].includes(2, Symbol()));
attempt("from a big integer in an empty array", () => [].indexOf(2, 1n));
attempt("lastIndexOf with an explicit undefined", () => [[2, 1, 2].lastIndexOf(2, undefined), [2, 1, 2].lastIndexOf(2)]);
