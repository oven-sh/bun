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

const log = [];
const comparators = {
  "a difference": (a, b) => a - b,
  "a reversed difference": (a, b) => b - a,
  "a boolean": (a, b) => a > b,
  "a text": (a, b) => String(a - b),
  "a text that is not a number": () => "abc",
  "NaN": () => NaN,
  "undefined": () => undefined,
  "null": () => null,
  "negative zero": () => -0,
  "a fraction": (a, b) => (a - b) / 10,
  "a tiny fraction": (a, b) => (a - b) * 1e-300,
  "infinities": (a, b) => (a < b ? -Infinity : a > b ? Infinity : 0),
  "a large number": (a, b) => (a - b) * 4294967296,
  "2 ** 31 times the sign": (a, b) => Math.sign(a - b) * 2147483648,
  "a bigint": (a, b) => BigInt(a - b),
  "a symbol": () => Symbol("s"),
  "an object with valueOf": (a, b) => ({
    valueOf() {
      log.push("valueOf");
      return a - b;
    },
  }),
  "an object that cannot be converted": () => Object.create(null),
  "an array": (a, b) => [a - b],
  "a date": (a, b) => new Date(a - b),
  "it throws": () => {
    throw new RangeError("no");
  },
};

function sorted(list, comparator) {
  return list.sort(comparator);
}

function sortedCopy(list, comparator) {
  return list.toSorted(comparator);
}

function typedSorted(list, comparator) {
  return Array.from(new Int32Array(list).sort(comparator));
}

for (let i = 0; i < 300; i++) {
  sorted([3, 1, 2], comparators["a difference"]);
  sortedCopy([3, 1, 2], comparators["a difference"]);
  typedSorted([3, 1, 2], comparators["a difference"]);
}

for (const name of Object.keys(comparators)) {
  log.length = 0;
  attempt("sort with " + name, () => sorted([5, 1, 4, 2, 3], comparators[name]));
  attempt("toSorted with " + name, () => sortedCopy([5, 1, 4, 2, 3], comparators[name]));
  attempt("typed sort with " + name, () => typedSorted([5, 1, 4, 2, 3], comparators[name]));
  if (log.length) console.log("  conversions:", log.length);
}
attempt("sort with a difference again", () => sorted([5, 1, 4, 2, 3], comparators["a difference"]));
attempt("a difference of texts", () => sorted(["10", "9", "1"], comparators["a difference"]));
attempt("a difference of mixed values", () => sorted([10, "9", true, null, [2]], comparators["a difference"]));
attempt("a difference with undefined and holes", () => sorted([3, undefined, 1, , 2], comparators["a difference"]));
attempt("no comparator sorts as texts", () => sorted([10, 9, 1, -1, -10, 2147483648, 1e21, 0.5, -0]));
attempt("a comparator that is not a function", () => sorted([2, 1], 5));
