function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function size(value) {
  return value.length;
}

function firstOf(value) {
  return value[0];
}

function tail(value) {
  return value.slice(1);
}

function has(value, what) {
  return value.includes(what);
}

function where(value, what) {
  return value.indexOf(what);
}

function joinTwo(value, other) {
  return value.concat(other);
}

function lastOf(value) {
  return value.at(-1);
}

function count(value) {
  let n = 0;
  for (const item of value) n++;
  return n;
}

function add(a, b) {
  return a + b;
}

function less(a, b) {
  return a < b;
}

function honest(round) {
  console.log(round, "size", size([1, 2]), size("ab"), size([]), size(""), size(new Array(3)), size("abc"));
  console.log(round, "firstOf", firstOf([1, 2]), firstOf("ab"), firstOf([]), firstOf(""), firstOf(["x"]), firstOf("x"));
  console.log(round, "tail", show(tail([1, 2])), show(tail("ab")), show(tail([])), show(tail("")));
  console.log(round, "has", has([1, 2], 2), has("ab", "b"), has([], 1), has("", ""), has([NaN], NaN), has("ab", "c"));
  console.log(round, "where", where([1, 2], 2), where("ab", "b"), where([NaN], NaN), where("", ""));
  console.log(round, "joinTwo", show(joinTwo([1], [2])), show(joinTwo("a", "b")), show(joinTwo([1], 2)), show(joinTwo("a", 1)));
  console.log(round, "lastOf", lastOf([1, 2]), lastOf("ab"), lastOf([]), lastOf(""));
  console.log(round, "count", count([1, 2]), count("ab"), count([]), count("\u{1f600}"));
  console.log(round, "add", add(1, 2), add("a", "b"), add(0.5, 0.5), add("", ""), add(-1, 1), add("x", "y"));
  console.log(round, "less", less(1, 2), less("a", "b"), less(2, 1), less("b", "a"), less("10", "9"), less(10, 9));
}

const neither = [
  ["a typed array", () => new Uint8Array([1, 2])],
  ["a String object", () => new String("ab")],
  ["an arguments object", () => (function () { return arguments; })(1, 2)],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["an object with every method", () => ({ length: "its own", 0: "its own", slice: () => "its own", includes: () => "its own", indexOf: () => "its own", concat: () => "its own", at: () => "its own", [Symbol.iterator]: () => [1, 2, 3][Symbol.iterator]() })],
  ["a Buffer", () => Buffer.from("ab")],
  ["a Set", () => new Set([1, 2])],
  ["a function", () => function (a, b) {}],
  ["a number", () => 12],
  ["null", () => null],
  ["undefined", () => undefined],
];

honest("before");
for (const [name, make] of neither) {
  attempt("size of " + name, () => size(make()));
  attempt("firstOf " + name, () => firstOf(make()));
  attempt("tail of " + name, () => tail(make()));
  attempt("has, " + name, () => has(make(), 2));
  attempt("where, " + name, () => where(make(), 2));
  attempt("joinTwo, " + name, () => joinTwo(make(), [3]));
  attempt("lastOf " + name, () => lastOf(make()));
  attempt("count of " + name, () => count(make()));
}
const mixed = [[1, "2"], ["1", 2], [1, 2n], [1n, 2n], [[1], [2]], [{}, 1], [null, 1], [undefined, "a"], [1, null], ["a", Symbol.iterator], [true, true], [-0, -0], [new Date(0), 1], ["10", 9], [10, "9"], ["a", 1], [NaN, NaN], [1n, 2], [1n, "2"], [[2], 10]];
for (const [a, b] of mixed) {
  const label = (typeof a === "object" ? JSON.stringify(a) : show(a)) + " and " + (typeof b === "object" ? JSON.stringify(b) : show(b));
  attempt("add " + label, () => (a instanceof Date ? typeof add(a, b) : add(a, b)));
  attempt("less " + label, () => less(a, b));
}
attempt("an array and a string", () => [joinTwo([1], "a"), joinTwo("a", [1]), has(["ab"], "a"), has("ab", ["a"]), where("1,2", [1, 2])]);
honest("after");
