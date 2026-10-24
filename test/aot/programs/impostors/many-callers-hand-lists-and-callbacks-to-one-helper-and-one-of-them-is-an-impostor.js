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

function each(list, visit) {
  for (let i = 0; i < list.length; i++) visit(list[i], i);
}

function mapWith(list, change) {
  const out = [];
  for (let i = 0; i < list.length; i++) out.push(change(list[i]));
  return out;
}

function fold(list, combine, start) {
  let result = start;
  for (const item of list) result = combine(result, item);
  return result;
}

function compose(f, g) {
  return value => f(g(value));
}

function times(n, f) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(f(i));
  return out;
}

function remember(f) {
  const cache = new Map();
  return value => {
    if (!cache.has(value)) cache.set(value, f(value));
    return cache.get(value);
  };
}

const double = n => n * 2;
const low = n => n & 3;
const plus = (a, b) => a + b;
const lengthOf = text => text.length;
const xOf = point => point.x;

function honest(round) {
  let sum = 0;
  each([1, 2, 3], n => { sum += n; });
  each([4, 5], (n, i) => { sum += n * i; });
  console.log(round, "each", sum);
  console.log(round, "mapWith", show(mapWith([1, 2, 3], double)), show(mapWith([5, 6], low)), show(mapWith(["a", "bc"], lengthOf)), show(mapWith([{ x: 1 }, { x: 2 }], xOf)), show(mapWith([], double)));
  console.log(round, "fold", fold([1, 2, 3], plus, 0), fold([], plus, 0), fold([0.5, 0.5], plus, 1), fold(["a", "b"], plus, ""));
  console.log(round, "compose", compose(double, low)(7), compose(low, double)(7), compose(double, lengthOf)("abc"), compose(double, xOf)({ x: 4 }));
  console.log(round, "times", show(times(3, double)), show(times(0, double)), show(times(2, low)));
  console.log(round, "remember", remember(double)(4), remember(lengthOf)("abc"), remember(xOf)({ x: 9 }));
}

const lists = [
  ["numbers and a string", () => [1, "2", 3]],
  ["a hole", () => [1, , 3]],
  ["a BigInt", () => [1, 2n]],
  ["an object with valueOf", () => [{ valueOf: () => (log.push("valueOf"), 5), length: "its own", x: "its own" }]],
  ["null inside", () => [1, null]],
  ["a string for the list", () => "12"],
  ["an array-like object for the list", () => ({ length: 2, 0: 1, 1: 2 })],
  ["a Set for the list", () => new Set([1, 2])],
  ["parsed JSON", () => JSON.parse('[1,"2",{"x":3},[4]]')],
  ["null for the list", () => null],
];

const callbacks = [
  ["a bound function", () => plus.bind(null, 10)],
  ["a callable proxy", () => new Proxy(double, { apply: (target, self, list) => "trapped " + list.length })],
  ["a class", () => class {}],
  ["an async function", () => async n => n],
  ["parseInt", () => parseInt],
  ["String", () => String],
  ["an object with call", () => ({ call: double })],
  ["undefined", () => undefined],
];

honest("before");
for (const [name, make] of lists) {
  attempt("mapWith double over " + name, () => mapWith(make(), double));
  attempt("mapWith low over " + name, () => mapWith(make(), low));
  attempt("mapWith lengthOf over " + name, () => mapWith(make(), lengthOf));
  attempt("mapWith xOf over " + name, () => mapWith(make(), xOf));
  attempt("fold plus over " + name, () => fold(make(), plus, 0));
  attempt("each over " + name, () => { const seen = []; each(make(), (item, i) => seen.push(typeof item + i)); return seen; });
}
for (const [name, make] of callbacks) {
  attempt("mapWith " + name, () => mapWith([1, 2], make()));
  attempt("mapWith " + name + " over nothing", () => mapWith([], make()));
  attempt("fold " + name, () => fold([1, 2], make(), 0));
  attempt("compose double with " + name, () => compose(double, make())(3));
  attempt("compose " + name + " with double", () => compose(make(), double)(3));
  attempt("times " + name, () => times(2, make()));
  attempt("remember " + name, () => remember(make())(3));
}
attempt("times with a string for the count", () => times("2", double));
attempt("times with a fraction", () => times(1.5, double));
attempt("times with an object", () => times({ valueOf: () => (log.push("valueOf"), 2) }, double));
attempt("remember tells zero from negative zero as a Map does", () => { const f = remember(n => 1 / n); return [f(0), f(-0), f(NaN), f(NaN)]; });
honest("after");
