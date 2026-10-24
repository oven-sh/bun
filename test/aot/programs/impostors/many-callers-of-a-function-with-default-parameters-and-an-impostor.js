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

function scale(n, factor = 2) {
  return n * factor;
}

function collect(item, into = []) {
  into.push(item);
  return into.length;
}

function area(size = { w: 2, h: 3 }) {
  return size.w * size.h;
}

function chain(a, b = a + 1, c = b * 2) {
  return a + b + c;
}

let made = 0;

function numbered(id = ++made) {
  return id * 10;
}

function greet(name = "nobody") {
  return name.toUpperCase();
}

function honest(round) {
  console.log(round, "scale", scale(1), scale(2, 3), scale(0.5), scale(-4, 0.5), scale(7, 1), scale(0));
  console.log(round, "collect", collect(1), collect(2, []), collect(3, [1, 2]), collect("a"), collect(4, new Array(1, 2, 3)));
  console.log(round, "area", area(), area({ w: 1, h: 1 }), area({ w: 4, h: 0.5 }), area(), area({ w: 3, h: 3 }));
  console.log(round, "chain", chain(1), chain(1, 2), chain(1, 2, 3), chain(0), chain(-1, 1));
  console.log(round, "numbered", numbered(), numbered(5), numbered(), numbered(0.5), made);
  console.log(round, "greet", greet(), greet("ann"), greet("bob"), greet(""), greet(`c${round}`));
}

const second = [
  ["undefined, which takes the default", () => undefined],
  ["null, which does not", () => null],
  ["a numeric string", () => "3"],
  ["an object with valueOf", () => ({ valueOf: () => (log.push("valueOf"), 3) })],
  ["a BigInt", () => 3n],
  ["an array-like object with push", () => ({ length: 5, push: Array.prototype.push })],
  ["a string", () => "abc"],
  ["an object of another shape", () => ({ h: 2, w: "3" })],
  ["zero", () => 0],
  ["false", () => false],
];

honest("before");
for (const [name, make] of second) {
  attempt("scale(2, " + name + ")", () => scale(2, make()));
  attempt("scale(" + name + ")", () => scale(make()));
  attempt("collect(1, " + name + ")", () => collect(1, make()));
  attempt("area(" + name + ")", () => area(make()));
  attempt("chain(" + name + ")", () => chain(make()));
  attempt("chain(1, " + name + ")", () => chain(1, make()));
  attempt("chain(1, undefined, " + name + ")", () => chain(1, undefined, make()));
  attempt("numbered(" + name + ")", () => numbered(make()) + " made " + made);
  attempt("greet(" + name + ")", () => greet(make()));
  attempt("scale.apply with " + name, () => scale.apply(null, [2, make()]));
  attempt("area through map of " + name, () => [make()].map(area)[0]);
  attempt("greet from hidden code with " + name, () => new Function("f", "value", "return f(value)")(greet, make()));
}
attempt("scale with a hole spread into it", () => scale(...[3, , ]));
attempt("scale.apply with a short array-like", () => scale.apply(null, { length: 2, 0: 3 }));
attempt("the lengths", () => [scale.length, collect.length, area.length, chain.length, numbered.length]);
honest("after");
