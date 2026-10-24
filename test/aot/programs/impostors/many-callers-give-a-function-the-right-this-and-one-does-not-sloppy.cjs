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

function span() {
  return this.x - this.y;
}

function total() {
  let sum = 0;
  for (let i = 0; i < this.length; i++) sum += this[i];
  return sum;
}

function shout() {
  return this.toUpperCase();
}

function double() {
  return this * 2;
}

function move() {
  this.x = this.x + 1;
  return this.x;
}

function Point(x, y) {
  this.x = x;
  this.y = y;
}

Point.prototype.span = span;
Point.prototype.move = move;

function honest(round) {
  console.log(round, "span", new Point(3, 1).span(), new Point(0.5, 0.25).span(), ({ x: 9, y: 4, span }).span(), span.call({ x: 1, y: 1 }), span.call(new Point(2, 1)));
  console.log(round, "total", total.call([1, 2, 3]), total.call([]), total.call(new Array(4, 5)), total.apply([0.5]), total.bind([6])());
  console.log(round, "shout", shout.call("abc"), shout.call(""), shout.call("x" + round), shout.apply("y"));
  console.log(round, "double", double.call(1), double.call(2.5), double.call(-3), double.apply(0));
  console.log(round, "move", new Point(3, 1).move(), new Point(0.5, 0).move(), move.call({ x: 1, y: 1 }), ({ x: 7, y: 0, move }).move());
}

const selves = [
  ["undefined", () => undefined],
  ["null", () => null],
  ["a number", () => 5],
  ["a string", () => "12"],
  ["an array", () => [1, 2]],
  ["a point in the other key order", () => ({ y: 1, x: 3 })],
  ["a point with getters", () => ({ get y() { log.push("y"); return 1; }, get x() { log.push("x"); return 3; } })],
  ["a frozen point", () => Object.freeze({ x: 3, y: 1 })],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a typed array", () => new Uint8Array([1, 2])],
  ["an object with valueOf and toUpperCase", () => ({ valueOf: () => (log.push("valueOf"), 4), toUpperCase: () => "its own" })],
  ["a String object", () => new String("ab")],
  ["a BigInt", () => 4n],
  ["a symbol", () => Symbol.iterator],
];

console.log("strict:", (function () { return this === undefined; })());
honest("before");
for (const [name, make] of selves) {
  attempt("span with " + name, () => span.call(make()));
  attempt("total with " + name, () => total.call(make()));
  attempt("shout with " + name, () => shout.call(make()));
  attempt("double with " + name, () => double.call(make()));
  attempt("move with " + name, () => move.call(make()));
  attempt("span through apply with " + name, () => span.apply(make(), []));
  attempt("total through bind with " + name, () => total.bind(make())());
  attempt("double through Reflect.apply with " + name, () => Reflect.apply(double, make(), []));
  attempt("shout as a callback with " + name, () => [0].map(shout, make())[0]);
}
attempt("span called plainly", () => typeof span());
attempt("total called plainly", () => typeof total());
attempt("double called plainly", () => typeof double());
attempt("a method taken off a point", () => { const taken = new Point(3, 1).span; return typeof taken(); });
attempt("Point without new", () => typeof Point.call({}, 1, 2));
attempt("Point applied to an array", () => { const list = []; Point.call(list, 1, 2); return [list.length, list.x, list.y, span.call(list)]; });
attempt("Point applied to a frozen object", () => Point.call(Object.freeze({}), 1, 2));
attempt("Point applied to a number", () => Point.call(5, 1, 2));
attempt("an object made without the constructor", () => Object.create(Point.prototype).span());
attempt("a point built with strings", () => [new Point("3", "1").span(), new Point("3", "1").move()]);
attempt("a point built with nothing", () => [new Point().span(), new Point().move()]);
attempt("a point built by Reflect.construct for another class", () => { const built = Reflect.construct(Point, [3, 1], Array); return [Array.isArray(built), built instanceof Point, built instanceof Array, built.x, typeof built.span]; });
honest("after");
