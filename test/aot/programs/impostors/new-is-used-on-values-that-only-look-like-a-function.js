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

function Pair(a, b) {
  this.a = a;
  this.b = b;
}

Pair.prototype.sum = function () {
  return this.a + this.b;
};

class Box {
  constructor(value) {
    this.value = value;
    this.target = new.target === Box ? "Box" : typeof new.target;
  }
}

function build(type) {
  return new type(1, 2);
}

function buildAndSum(type) {
  return new type(1, 2).sum();
}

function targetOf(type) {
  return Reflect.construct(function () { return { seen: new.target === type }; }, [], type);
}

function honest(round) {
  console.log(round, show(build(Pair)), show(build(Box)), show(build(Object)), show(build(function () {})), show(build(class {})), buildAndSum(Pair), buildAndSum(class extends Pair {}));
}

const types = [
  ["a function that answers an object", () => function () { return { other: true, sum: () => "other" }; }],
  ["a function that answers a number", () => function () { this.kept = true; return 5; }],
  ["a function that answers null", () => function () { this.kept = true; return null; }],
  ["a function that answers a function", () => function () { return Object.assign(() => {}, { sum: () => "from a function" }); }],
  ["a function whose prototype is null", () => Object.assign(function () { this.proto = Object.getPrototypeOf(this) === Object.prototype; }, { prototype: null })],
  ["a function whose prototype is an array", () => Object.assign(function () { this.isArray = Array.isArray(this); this.size = this.length; }, { prototype: [1, 2] })],
  ["a function whose prototype is Pair's", () => Object.assign(function (a, b) { this.a = a * 10; this.b = b * 10; }, { prototype: Pair.prototype })],
  ["a bound Pair", () => Pair.bind({ ignored: true }, 10)],
  ["a bound Box", () => Box.bind(null, "bound")],
  ["a proxy of Pair", () => new Proxy(Pair, {})],
  ["a proxy that swaps the arguments", () => new Proxy(Pair, { construct: (target, [a, b], newTarget) => Reflect.construct(target, [b * 10, a], newTarget) })],
  ["a proxy that hands out another prototype", () => new Proxy(Pair, { get: (target, key) => (log.push("get " + String(key)), key === "prototype" ? { sum: () => "from the trap" } : target[key]) })],
  ["a subclass that changes the fields", () => class extends Pair { constructor(a, b) { super(a, b); this.a = "a"; delete this.b; } }],
  ["a subclass that overrides sum", () => class extends Pair { sum() { return "overridden " + super.sum(); } }],
  ["a subclass of a function chosen at run time", () => class extends [Pair, Box][0] {}],
  ["an arrow function", () => () => {}],
  ["a method", () => ({ method() {} }).method],
  ["an async function", () => async function () {}],
  ["a generator function", () => function* () {}],
  ["Symbol", () => Symbol],
  ["Math.max", () => Math.max],
  ["an object", () => ({})],
  ["a string", () => "Pair"],
  ["undefined", () => undefined],
];

honest("before");
for (const [name, make] of types) {
  attempt("new on " + name, () => build(make()));
  attempt("new on " + name + ", then its sum", () => buildAndSum(make()));
  attempt("Reflect.construct of " + name, () => Reflect.construct(make(), [1, 2]));
  attempt("Pair built for " + name, () => { const built = Reflect.construct(Pair, [1, 2], make()); return [built.a, typeof built.sum]; });
  attempt("new.target is " + name, () => targetOf(make()));
}
attempt("Pair without new", () => Pair(1, 2));
attempt("Box without new", () => Box(1));
attempt("Box through call", () => Box.call({}, 1));
attempt("Pair through call on an object", () => { const object = {}; Pair.call(object, 1, 2); return object; });
attempt("new with no parentheses", () => new Pair);
attempt("new on a member", () => new ({ Pair }.Pair)(1, 2).sum());
attempt("new on the result of a call", () => new (() => Pair)()(1, 2) === undefined);
attempt("new.target in a plain call", () => (function () { return new.target; })());
attempt("new.target in an arrow function inside a constructor", () => new (function Outer() { return { same: (() => new.target)() === Outer }; })());
attempt("Box built for Pair", () => { const built = Reflect.construct(Box, [1], Pair); return [built.target, built instanceof Pair, built instanceof Box, built.value]; });
for (let i = 0; i < 2000; i++) buildAndSum(Pair);
for (const [name, make] of types) attempt("after 2000 pairs, new on " + name + ", then its sum", () => buildAndSum(make()));
honest("after");
