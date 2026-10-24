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

function adder(k) {
  return function (x) {
    return x + k;
  };
}

function callWith(f, x) {
  return f(x);
}

function pair(k) {
  function scale(x) {
    return x * k;
  }
  function run(x) {
    return scale(x) + k;
  }
  function replace(f) {
    scale = f;
  }
  function rebase(next) {
    k = next;
  }
  return { run, replace, rebase };
}

function counter() {
  let count = 0;
  return { up: () => ++count, read: () => count, set: value => { count = value; } };
}

class Scaler {
  constructor(k) {
    this.scale = x => x * k;
    this.k = k;
  }

  run(x) {
    return this.scale(x) + this.k;
  }
}

function honest(round) {
  console.log(round, callWith(adder(1), 1), callWith(adder(10), 1), callWith(adder(0.5), 1), callWith(adder(-1), 1), adder(2)(3), adder(20)(3));
  console.log(round, pair(1).run(2), pair(10).run(2), pair(0.5).run(2), new Scaler(1).run(2), new Scaler(10).run(2));
}

honest("before");
const adders = [adder(1), adder(10), adder("s"), adder(1n), adder(null), adder({ valueOf: () => 5 }), adder(undefined), adder(-0)];
for (const [i, f] of adders.entries()) {
  attempt("adder number " + i + " of one", () => callWith(f, 1));
  attempt("adder number " + i + " of negative zero", () => callWith(f, -0));
}
for (let i = 0; i < 2000; i++) callWith(adders[0], i);
for (const [i, f] of adders.entries()) attempt("after 2000 calls of the first, adder number " + i, () => callWith(f, 1));

const one = pair(1);
const ten = pair(10);
attempt("two activations", () => [one.run(2), ten.run(2)]);
ten.replace(x => "replaced " + x);
attempt("the inner function of one activation was replaced", () => [one.run(2), ten.run(2)]);
ten.replace(adder(100));
attempt("by a closure of another function", () => [one.run(2), ten.run(2)]);
ten.replace(pair(1000).run);
attempt("by the run of a third activation", () => [one.run(2), ten.run(2)]);
ten.replace(class {});
attempt("by a class", () => one.run(2) + " " + ten.run(2));
ten.replace("text");
attempt("by a string", () => one.run(2) + " " + ten.run(2));
attempt("the other activation never changed", () => one.run(2));
one.rebase("k");
attempt("the captured number of one activation became a string", () => [one.run(2), pair(3).run(2)]);
one.rebase(2n);
attempt("then a BigInt", () => one.run(2));
attempt("with a BigInt for the argument", () => one.run(2n));

const first = counter();
const second = counter();
attempt("two counters", () => [first.up(), first.up(), second.up(), first.read(), second.read()]);
second.set("5");
attempt("one of them holds a string now", () => [first.up(), second.up(), second.read()]);
second.set(2147483647);
attempt("then the largest small integer", () => [second.up(), second.up(), first.up()]);
second.set(1n);
attempt("then a BigInt", () => [second.up(), first.up()]);
second.set({ valueOf: () => (log.push("valueOf"), 7) });
attempt("then an object", () => [second.up(), second.up(), first.up()]);

const scalers = [new Scaler(1), new Scaler(10)];
scalers[1].scale = "not a function";
attempt("the closure in a field of one instance was replaced", () => scalers[0].run(2) + " " + scalers[1].run(2));
scalers[1].scale = scalers[0].scale;
attempt("by the closure of the other instance", () => [scalers[0].run(2), scalers[1].run(2)]);
attempt("run is borrowed for an object that is no Scaler", () => Scaler.prototype.run.call({ scale: x => "borrowed " + x, k: "!" }, 2));

let factorial = function self(n) {
  return n <= 1 ? 1 : n * self(n - 1);
};
const kept = factorial;
factorial = null;
attempt("a function expression calls itself by its own name", () => kept(5));
let loose = function (n) {
  return n <= 1 ? 1 : n * loose(n - 1);
};
const keptLoose = loose;
loose = n => "replaced " + n;
attempt("another calls itself through a variable that was replaced", () => keptLoose(5));
honest("after");
