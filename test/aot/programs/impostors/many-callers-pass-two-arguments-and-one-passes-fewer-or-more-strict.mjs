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

function add(a, b) {
  return a + b;
}

function howMany(a, b) {
  return arguments.length;
}

function storeThroughArguments(a, b) {
  arguments[0] = 10;
  arguments[1] = 20;
  return [a, b];
}

function storeThroughParameters(a, b) {
  a = 10;
  b = 20;
  return [arguments[0], arguments[1], arguments.length];
}

function third(a, b) {
  return arguments[2];
}

function forward(a, b) {
  return add.apply(null, arguments);
}

function forwardSpread(a, b) {
  return add(...arguments);
}

function lastOne() {
  return arguments[arguments.length - 1];
}

function sumOfArguments() {
  let total = 0;
  for (let i = 0; i < arguments.length; i++) total += arguments[i];
  return total;
}

function shorten(a, b) {
  arguments.length = 1;
  return [Array.prototype.slice.call(arguments), b];
}

function honest(round) {
  console.log(round, "add", add(1, 2), add(0.5, 0.5), add(-1, 1), add(10, 20), add(3, 4), add(1e10, 1));
  console.log(round, "howMany", howMany(1, 2), howMany(3, 4), howMany(5, 6), howMany(7, 8));
  console.log(round, "storeThroughArguments", show(storeThroughArguments(1, 2)), show(storeThroughArguments(3, 4)));
  console.log(round, "storeThroughParameters", show(storeThroughParameters(1, 2)), show(storeThroughParameters(3, 4)));
  console.log(round, "third", third(1, 2), third(3, 4), third(5, 6));
  console.log(round, "forward", forward(1, 2), forward(3, 4), forwardSpread(1, 2), forwardSpread(3, 4));
  console.log(round, "lastOne", lastOne(1), lastOne(1, 2), lastOne(1, 2, 3));
  console.log(round, "sumOfArguments", sumOfArguments(1, 2), sumOfArguments(1, 2, 3), sumOfArguments(0.5));
  console.log(round, "shorten", show(shorten(1, 2)), show(shorten(3, 4)));
}

const lists = [
  ["nothing", []],
  ["one", [1]],
  ["one undefined", [undefined]],
  ["two", [1, 2]],
  ["three", [1, 2, 3]],
  ["nine", [1, 2, 3, 4, 5, 6, 7, 8, 9]],
  ["a string and a number", ["1", 2]],
  ["two objects", [{ valueOf: () => (log.push("first"), 1) }, { valueOf: () => (log.push("second"), 2) }]],
];

console.log("strict:", (function () { return this === undefined; })());
honest("before");
attempt("add()", () => add());
attempt("add(1)", () => add(1));
attempt("add(1, 2, 3)", () => add(1, 2, 3));
attempt("howMany()", () => howMany());
attempt("howMany(1)", () => howMany(1));
attempt("howMany(undefined, undefined, undefined)", () => howMany(undefined, undefined, undefined));
attempt("storeThroughArguments()", () => storeThroughArguments());
attempt("storeThroughArguments(1)", () => storeThroughArguments(1));
attempt("storeThroughArguments(1, 2, 3)", () => storeThroughArguments(1, 2, 3));
attempt("storeThroughParameters()", () => storeThroughParameters());
attempt("storeThroughParameters(1)", () => storeThroughParameters(1));
attempt("third(1, 2, 3)", () => third(1, 2, 3));
attempt("lastOne()", () => lastOne());
for (const [name, list] of lists) {
  attempt("add of " + name, () => add(...list));
  attempt("add.apply of " + name, () => add.apply(null, list));
  attempt("howMany of " + name, () => howMany(...list));
  attempt("howMany.call of " + name, () => howMany.call(null, ...list));
  attempt("storeThroughArguments of " + name, () => storeThroughArguments(...list));
  attempt("storeThroughParameters of " + name, () => storeThroughParameters(...list));
  attempt("third of " + name, () => third(...list));
  attempt("forward of " + name, () => forward(...list));
  attempt("forwardSpread of " + name, () => forwardSpread(...list));
  attempt("lastOne of " + name, () => lastOne(...list));
  attempt("sumOfArguments of " + name, () => sumOfArguments(...list));
  attempt("shorten of " + name, () => shorten(...list));
}
attempt("add as a callback of map", () => [1, 2].map(add));
attempt("howMany as a callback of map, forEach's cousin", () => [1].map(howMany));
attempt("howMany as a comparator", () => { let seen; [2, 1].sort(function (a, b) { seen = howMany.apply(null, arguments); return a - b; }); return seen; });
attempt("howMany bound to three", () => howMany.bind(null, 1, 2, 3)(4));
attempt("howMany from hidden code", () => new Function("f", "return f(1, 2, 3, 4, 5)")(howMany));
attempt("the lengths", () => [add.length, lastOne.length, howMany.bind(null, 1).length]);
honest("after");
