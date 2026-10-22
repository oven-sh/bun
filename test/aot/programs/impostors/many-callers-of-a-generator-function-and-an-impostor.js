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

function* doubles(list) {
  for (let i = 0; i < list.length; i++) yield list[i] * 2;
}

function* upTo(n) {
  for (let i = 0; i < n; i++) yield i;
}

function* adder() {
  let sum = 0;
  for (;;) {
    const n = yield sum;
    if (n === "stop") return sum;
    sum += n;
  }
}

function* lows() {
  let seen = 0;
  for (;;) seen = (yield seen) & 7;
}

function* relay(inner) {
  const result = yield* inner;
  return result;
}

function* late(point) {
  const x = point.x;
  yield "paused";
  return x - point.y;
}

function feed(generator, values) {
  const out = [generator.next().value];
  for (const value of values) out.push(generator.next(value).value);
  return out;
}

function honest(round) {
  console.log(round, "doubles", show([...doubles([1, 2, 3])]), show([...doubles([])]), show([...doubles(new Array(4, 5))]), show([...doubles([0.5])]));
  console.log(round, "upTo", show([...upTo(3)]), show([...upTo(0)]), show([...upTo(1)]), show([...upTo(5)]));
  console.log(round, "adder", show(feed(adder(), [1, 2, 3])), show(feed(adder(), [0.5, 0.25])), show(feed(adder(), [-1, 1, "stop"])));
  console.log(round, "lows", show(feed(lows(), [1, 9, 255])), show(feed(lows(), [8, 7])));
  console.log(round, "relay", show([...relay([1, 2])]), show([...relay([])]), show([...relay(doubles([1]))]));
  console.log(round, "late", show([...late({ x: 3, y: 1 })]), show(feed(late({ x: 3, y: 1 }), [0])), show(feed(late({ x: 0.5, y: 0.25 }), [0])));
}

const notLists = [
  ["a string", () => "12"],
  ["an array-like object", () => ({ 0: 1, 1: "2", length: 2 })],
  ["a typed array", () => new Uint8Array([200, 2])],
  ["holes", () => new Array(2)],
  ["BigInts", () => [1n]],
  ["null", () => null],
];

const notNumbers = [
  ["a numeric string", () => "2"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 2) })],
  ["a BigInt", () => 2n],
  ["a fraction", () => 1.5],
  ["null", () => null],
  ["undefined", () => undefined],
  ["two to the 32nd and three", () => 4294967299],
];

const notIterables = [
  ["a string", () => "ab"],
  ["a Set", () => new Set([1, 2])],
  ["a generator that returns a value", () => (function* () { yield 1; return "the end"; })()],
  ["an iterator made by hand", () => ({ [Symbol.iterator]() { let i = 0; return { next: value => (log.push("next " + value), { done: i++ > 1, value: i }) }; } })],
  ["an array-like object", () => ({ 0: 1, length: 1 })],
  ["a number", () => 5],
  ["undefined", () => undefined],
];

honest("before");
for (const [name, make] of notLists) {
  attempt("doubles of " + name, () => [...doubles(make())]);
  attempt("doubles through apply of " + name, () => [...doubles.apply(null, [make()])]);
  attempt("doubles as a callback of " + name, () => [make()].flatMap(value => [...doubles(value)]));
}
for (const [name, make] of notNumbers) {
  attempt("upTo " + name, () => { const out = []; for (const i of upTo(make())) if (out.push(i) > 3) break; return out; });
  attempt("adder is sent " + name, () => feed(adder(), [1, make(), 1]));
  attempt("lows is sent " + name, () => feed(lows(), [1, make(), 1]));
  attempt("adder is sent " + name + " by hidden code", () => new Function("g", "value", "g.next(); g.next(1); return g.next(value).value")(adder(), make()));
}
for (const [name, make] of notIterables) attempt("relay of " + name, () => feed(relay(make()), ["first", "second", "third"]));

attempt("a generator after the value it was sent made it throw", () => {
  const generator = adder();
  generator.next();
  generator.next(1);
  try {
    generator.next(1n);
  } catch (error) {
    log.push(error.constructor.name);
  }
  return generator.next(1);
});
attempt("a point that changes at the pause", () => {
  const point = { x: 3, y: 1 };
  const generator = late(point);
  generator.next();
  point.y = "2";
  return generator.next().value;
});
attempt("a point whose y becomes a getter at the pause", () => {
  const point = { x: 3, y: 1 };
  const generator = late(point);
  generator.next();
  Object.defineProperty(point, "y", { get: () => (log.push("get y"), 2) });
  return generator.next().value;
});
attempt("nothing runs before the first next", () => typeof late(null).next);
attempt("and then it throws", () => late(null).next());
attempt("a generator function is not a constructor", () => new upTo(1));
attempt("return in the middle", () => { const generator = upTo(3); return [generator.next().value, generator.return("early").value, generator.next().done]; });
attempt("throw in the middle", () => { const generator = upTo(3); generator.next(); return generator.throw(new RangeError("no")); });
honest("after");
