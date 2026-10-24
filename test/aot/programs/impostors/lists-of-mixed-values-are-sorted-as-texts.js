function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

const log = [];

function sorted(values) {
  return values.slice().sort();
}

function sortedByOrder(values) {
  return values.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function sortedByLocale(values) {
  return values.slice().sort((a, b) => a.localeCompare(b));
}

function sortedByLength(values) {
  return values.slice().sort((a, b) => a.length - b.length);
}

function sortedByCollator(values) {
  return values.slice().sort(new Intl.Collator("en").compare);
}

function sortedCopy(values) {
  return values.toSorted();
}

function smallestText(values) {
  return values.reduce((best, value) => (value < best ? value : best));
}

function joined(values, separator) {
  return values.join(separator);
}

const uses = [
  ["sort()", sorted],
  ["sort by < and >", sortedByOrder],
  ["sort by localeCompare", sortedByLocale],
  ["sort by length", sortedByLength],
  ["sort by a collator", sortedByCollator],
  ["toSorted()", sortedCopy],
  ["smallest", smallestText],
];

const lists = [
  "['b', 'a', 'c']",
  "['b', 'A', 'a', 'B']",
  "[10, 9, 1, 100]",
  "['10', 9, '1', 100]",
  "[-1, -2, 0, -0]",
  "['b', undefined, 'a', undefined]",
  "['b', , 'a']",
  "['b', null, 'a']",
  "[true, false, 'maybe']",
  "[[2, 1], [10], [1, 5]]",
  "[{}, 'a', '[']",
  "['\\u00e9', 'z', 'e', 'E']",
  "['\\uffff', '\\ud800\\udc00', 'a']",
  "['a', new String('a'), 'A']",
  "[1n, 2, '3', 10n]",
  "['a', Symbol('s')]",
  "['', ' ', '0', 0]",
  "[NaN, 'N', 'O', Infinity]",
  "['aa', 'a', 'aaa', '']",
  "[1e21, 1e3, 2]",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += use(["b", "a", "c"]).length;
  total += joined(["a", "b"], "-").length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of lists) attempt(name + " of " + text, () => use(make(text)));
}

attempt("how often elements are converted by sort()", () => {
  const noisy = name => ({ toString() { log.push(name); return name; } });
  const result = sorted([noisy("b"), noisy("a"), noisy("c")]).map(String);
  const conversions = log.splice(0);
  return [result, conversions.length >= 6];
});
attempt("a comparator that returns texts", () => [3, 1, 2].sort((a, b) => String(a - b)));
attempt("a comparator that returns nothing", () => [3, 1, 2].sort(() => undefined));
attempt("a comparator that returns true and false", () => [3, 1, 2].sort((a, b) => a > b));
attempt("a comparator that returns a BigInt", () => [3, 1, 2].sort((a, b) => BigInt(a - b)));
attempt("a comparator that returns an object", () => [3, 1, 2].sort((a, b) => ({ valueOf: () => a - b })));
attempt("a comparator that is a text", () => [3, 1, 2].sort("ascending"));
attempt("a comparator that is null", () => [3, 1, 2].sort(null));

for (const separator of ["'-'", "''", "undefined", "null", "0", "[]", "['+']", "{ toString() { return '~'; } }", "new String('=')", "Symbol('-')", "1n", "true"]) {
  attempt("joined by " + separator, () => joined(["a", 1, null, undefined, ["b", "c"]], make(separator)));
}
attempt("the separator is converted before the elements and after the length", () => {
  const values = { get length() { log.push("length"); return 2; }, get 0() { log.push("0"); return "a"; }, get 1() { log.push("1"); return "b"; } };
  return [Array.prototype.join.call(values, { toString() { log.push("separator"); return "-"; } }), log.splice(0)];
});
attempt("a list that holds itself", () => {
  const values = ["a"];
  values.push(values, "b");
  return joined(values, "-");
});
