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

class Cell {
  n = 0;
  optional = undefined;
  #hidden = 0;
  static shared = 0;
  set(value) {
    this.n = value;
    this.optional = value;
    this.#hidden = value;
    Cell.shared = value;
  }
  clear() {
    this.optional = undefined;
  }
  clearToNull() {
    this.optional = null;
  }
  read() {
    return [this.n, this.optional, this.#hidden, Cell.shared];
  }
}

function Old(n) {
  this.n = n;
  this.maybe = null;
}
Old.prototype.set = function (value) {
  this.n = value;
  this.maybe = value;
};

function makeCounter() {
  let n = 0;
  let maybe;
  return {
    set(value) {
      n = value;
      maybe = value;
    },
    read: () => [n, maybe, typeof n, typeof maybe],
    down: () => --n,
  };
}

let atTheTop = 0;
let maybeAtTheTop = null;

function describe(holder, key) {
  return [holder[key], typeof holder[key], holder[key] === undefined, holder[key] === null, key in holder, holder[key] + 1, holder[key] | 0];
}

const cell = new Cell();
const old = new Old(0);
const literal = { n: 0, maybe: undefined };
const counter = makeCounter();
const list = [0, 1, 2];
for (let i = 0; i < 2000; i++) {
  cell.set(i);
  if (i & 1) cell.clear();
  else cell.clearToNull();
  old.set(i);
  literal.n = i;
  literal.maybe = i & 1 ? i : undefined;
  counter.set(i);
  list[i % 3] = i;
  atTheTop = i;
  maybeAtTheTop = i & 1 ? i : null;
}

for (const value of [-2147483641, -2147483642, -2147483643, -2147483644, -2147483645, -2147483646, -2147483647, -2147483648, -2147483649, 2147483647, 2147483646]) {
  cell.set(value);
  old.set(value);
  literal.n = value;
  literal.maybe = value;
  counter.set(value);
  list[1] = value;
  atTheTop = value;
  maybeAtTheTop = value;
  attempt(value + " in a class", () => cell.read());
  attempt(value + " in a class, described", () => [describe(cell, "n"), describe(cell, "optional")]);
  attempt(value + " in a constructor function's object", () => [describe(old, "n"), describe(old, "maybe")]);
  attempt(value + " in an object literal", () => [describe(literal, "n"), describe(literal, "maybe")]);
  attempt(value + " as JSON", () => JSON.stringify([cell, old, literal]));
  attempt(value + " keys", () => [Object.keys(cell), Object.keys(old), Object.keys(literal)]);
  attempt(value + " in captured variables", () => counter.read());
  attempt(value + " in an array", () => [list, 1 in list, list[1] + 1]);
  attempt(value + " in module variables", () => [atTheTop, maybeAtTheTop, typeof atTheTop, typeof maybeAtTheTop]);
  attempt(value + " in a fresh literal", () => ({ n: value, maybe: value }));
  attempt(value + " in a fresh object", () => new Old(value).n);
}

counter.set(-2147483640);
attempt("a captured counter counts down to the smallest int32 and past it", () => {
  const seen = [];
  for (let i = 0; i < 11; i++) seen.push(counter.down());
  return seen;
});
literal.n = -2147483640;
attempt("a member counts down to the smallest int32 and past it", () => {
  const seen = [];
  for (let i = 0; i < 11; i++) seen.push(--literal.n);
  return seen;
});
cell.set(-2147483640);
attempt("a class field counts down to the smallest int32 and past it", () => {
  const seen = [];
  for (let i = 0; i < 11; i++) seen.push(--cell.n, cell.n === undefined, cell.n === null);
  return seen;
});
