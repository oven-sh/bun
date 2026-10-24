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

function countWithOr(words) {
  const counts = {};
  for (const word of words) counts[word] = (counts[word] || 0) + 1;
  return counts;
}

function countWithIncrement(words) {
  const counts = {};
  for (const word of words) counts[word]++;
  return counts;
}

function countWithIn(words) {
  const counts = {};
  for (const word of words) {
    if (word in counts) counts[word]++;
    else counts[word] = 1;
  }
  return counts;
}

function countWithNullish(words) {
  const counts = {};
  for (const word of words) {
    counts[word] ??= 0;
    counts[word] += 1;
  }
  return counts;
}

function countWithoutAPrototype(words) {
  const counts = Object.create(null);
  for (const word of words) counts[word] = (counts[word] || 0) + 1;
  return Object.keys(counts).map(key => key + "=" + show(counts[key]));
}

function countInAMap(words) {
  const counts = new Map();
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  return [...counts].map(([key, count]) => show(key) + "=" + show(count));
}

function countInAnArray(numbers) {
  const counts = [];
  for (const n of numbers) counts[n] = (counts[n] || 0) + 1;
  return [counts.length > 50 ? counts.length : counts, Object.keys(counts)];
}

function described(counts) {
  return Object.keys(counts).map(key => key + "=" + (typeof counts[key] === "number" ? show(counts[key]) : typeof counts[key]));
}

const honest = ["a", "b", "a", "c", "a"];
for (let i = 0; i < 1000; i++) {
  countWithOr(honest);
  countWithIncrement(honest);
  countWithIn(honest);
  countWithNullish(honest);
  countWithoutAPrototype(honest);
  countInAMap(honest);
  countInAnArray([1, 2, 1]);
}

const lists = {
  "plain words": honest,
  "names of Object.prototype": ["constructor", "toString", "constructor", "valueOf", "hasOwnProperty"],
  "__proto__": ["__proto__", "__proto__", "a"],
  "numbers and their texts": [1, "1", 1.0, "01", 1n, true, "true"],
  "zeros": [0, -0, "0", "-0"],
  "odd keys": [null, undefined, NaN, "null", "undefined", "NaN", ""],
  "large and small numbers": [1e21, 1e-7, 2 ** 32, 2 ** 32 - 2, -1, 1.5],
  "arrays and objects": [[1], "1", [1, 2], "1,2", {}, "[object Object]"],
};
for (const name of Object.keys(lists)) {
  attempt("countWithOr of " + name, () => described(countWithOr(lists[name])));
  attempt("countWithIncrement of " + name, () => described(countWithIncrement(lists[name])));
  attempt("countWithIn of " + name, () => described(countWithIn(lists[name])));
  attempt("countWithNullish of " + name, () => described(countWithNullish(lists[name])));
  attempt("countWithoutAPrototype of " + name, () => countWithoutAPrototype(lists[name]));
  attempt("countInAMap of " + name, () => countInAMap(lists[name]));
  attempt("countInAnArray of " + name, () => countInAnArray(lists[name]));
}
attempt("a symbol as a word", () => Reflect.ownKeys(countWithOr([Symbol.iterator, Symbol.iterator])).length);
