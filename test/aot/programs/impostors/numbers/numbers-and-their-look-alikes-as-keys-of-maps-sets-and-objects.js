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

const keys = [1, "1", 1.0, 1n, true, new Number(1), [1], 0, -0, "0", "-0", NaN, "NaN", 0 / 0, 1.5, "1.5", 2147483648, "2147483648", 2 ** 53, 2 ** 53 + 1, null, "null", undefined, "undefined", Infinity, "Infinity"];

function inAMap(list) {
  const map = new Map();
  for (let i = 0; i < list.length; i++) map.set(list[i], i);
  return [...map].map(([key, at]) => show(key) + ":" + at);
}

function inASet(list) {
  const set = new Set();
  for (let i = 0; i < list.length; i++) set.add(list[i]);
  return [...set];
}

function inAnObject(list) {
  const object = {};
  for (let i = 0; i < list.length; i++) object[list[i]] = i;
  return Object.keys(object).map(key => key + ":" + object[key]);
}

function lookedUp(map, key) {
  return [map.has(key), map.get(key)];
}

function computedKey(a, b) {
  return a / b;
}

for (let i = 0; i < 1000; i++) {
  inAMap([i, i + 1]);
  inASet([i, i + 1]);
  inAnObject([i, i + 1]);
  computedKey(i * 2, 2);
}

attempt("inAMap", () => inAMap(keys));
attempt("inASet", () => inASet(keys));
attempt("inAnObject", () => inAnObject(keys));

const numbers = new Map([[0, "zero"], [1, "one"], [2, "two"], [2147483648, "large"], [0.5, "a half"], [NaN, "not a number"]]);
for (let i = 0; i < 1000; i++) lookedUp(numbers, i % 3);
for (const key of keys) attempt("lookedUp(" + show(key) + ")", () => lookedUp(numbers, key));
attempt("a key computed as 4 / 2", () => lookedUp(numbers, computedKey(4, 2)));
attempt("a key computed as 1 / 2", () => lookedUp(numbers, computedKey(1, 2)));
attempt("a key computed as 0 / -1", () => lookedUp(numbers, computedKey(0, -1)));
attempt("a key computed as 0 / 0", () => lookedUp(numbers, computedKey(0, 0)));
attempt("a key computed as 2 ** 31", () => lookedUp(numbers, 2147483647 + computedKey(2, 2)));
attempt("a key computed as 0.1 + 0.4", () => lookedUp(numbers, 0.1 + 0.4));
attempt("a key computed as 0.1 + 0.2 + 0.2", () => lookedUp(numbers, 0.1 + 0.2 + 0.2));
attempt("a key from a Float32Array", () => lookedUp(numbers, new Float32Array([0.5, 2])[0]));
attempt("a key from an Int8Array", () => lookedUp(numbers, new Int8Array([2])[0]));
attempt("a key from JSON", () => lookedUp(numbers, JSON.parse("2.0")));
attempt("a key from a text", () => lookedUp(numbers, +"2"));
attempt("a WeakMap takes no number", () => new WeakMap().set(1, 1));
attempt("groupBy", () => Object.keys(Object.groupBy([1, "1", 1.5, -0, 0], value => value)));
attempt("Map.groupBy", () => [...Map.groupBy([1, "1", 1.5, -0, 0, NaN, NaN], value => value).keys()]);
