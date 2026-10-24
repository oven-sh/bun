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

function sumAll(...numbers) {
  let total = 0;
  for (let i = 0; i < numbers.length; i++) total += numbers[i];
  return total;
}

function largest(...numbers) {
  return Math.max(...numbers);
}

function describe(first, ...rest) {
  return first + ":" + rest.length + ":" + rest.join("-") + ":" + Array.isArray(rest);
}

function grow(...list) {
  list.push(9);
  list[0] = "changed";
  return list.length;
}

function lows(...numbers) {
  return numbers.map(n => n & 3).join();
}

function honest(round) {
  console.log(round, "sumAll", sumAll(1, 2, 3), sumAll(), sumAll(0.5), sumAll(1, 2, 3, 4, 5, 6, 7, 8), sumAll(...[1, 2]), sumAll(-1, 1));
  console.log(round, "largest", largest(1, 2, 3), largest(5), largest(-1, -2), largest(0.5, 0.25), largest(...[7, 8, 9]));
  console.log(round, "describe", describe(1), describe(1, 2), describe(1, 2, 3), describe("a", "b"), describe());
  console.log(round, "grow", grow(), grow(1), grow(1, 2), grow(...[1, 2, 3]));
  console.log(round, "lows", lows(1, 2, 3), lows(4, 5), lows(), lows(255));
}

const lists = [
  ["a string among numbers", () => [1, "2", 3]],
  ["an object with valueOf", () => [1, { valueOf: () => (log.push("valueOf"), 2) }]],
  ["BigInts only", () => [1n, 2n]],
  ["a BigInt among numbers", () => [1, 2n]],
  ["undefined and null", () => [undefined, null]],
  ["a hole", () => [1, , 3]],
  ["an array as one argument", () => [[1, 2]]],
  ["negative zero", () => [-0]],
  ["NaN", () => [1, NaN]],
  ["a symbol", () => [Symbol("s")]],
];

const spreadable = [
  ["a string", () => "12"],
  ["a Set", () => new Set([1, "2"])],
  ["a Map", () => new Map([[1, 2]])],
  ["a generator", () => (function* () { yield 1; yield "2"; })()],
  ["a typed array", () => new Float32Array([1.5, 2.5])],
  ["an arguments object", () => (function () { return arguments; })(1, "2")],
  ["an array-like object", () => ({ length: 2, 0: 1 })],
  ["null", () => null],
];

honest("before");
for (const [name, make] of lists) {
  attempt("sumAll of " + name, () => sumAll(...make()));
  attempt("largest of " + name, () => largest(...make()));
  attempt("describe " + name, () => describe(...make()));
  attempt("lows of " + name, () => lows(...make()));
  attempt("sumAll.apply of " + name, () => sumAll.apply(null, make()));
  attempt("largest through Reflect.apply of " + name, () => Reflect.apply(largest, null, make()));
}
for (const [name, make] of spreadable) {
  attempt("sumAll of the spread of " + name, () => sumAll(...make()));
  attempt("sumAll.apply of " + name, () => sumAll.apply(null, make()));
  attempt("describe the spread of " + name, () => describe(...make()));
  attempt("describe.apply of " + name, () => describe.apply(null, make()));
}
const mine = [1, 2, 3];
attempt("grow does not touch the caller's array", () => [grow(...mine), mine]);
attempt("nor through apply", () => [grow.apply(null, mine), mine]);
attempt("sumAll as a callback of map", () => [1, 2].map(sumAll));
attempt("sumAll as a callback of reduce", () => [1, 2, 3].reduce(sumAll));
attempt("describe as a callback of replace", () => "abc".replace(/(b)/, describe));
attempt("the lengths", () => [sumAll.length, describe.length]);
honest("after");
