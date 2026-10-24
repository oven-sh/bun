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

function orEmpty(list) {
  if (!list) list = [];
  return list.length;
}

function orZero(n) {
  n = n || 0;
  return n + 1;
}

function toNumber(n) {
  n = +n;
  return n * 2;
}

function toInteger(n) {
  n |= 0;
  return n + 1;
}

function toText(text) {
  text = "" + text;
  return text.length;
}

function wrapped(list) {
  if (!Array.isArray(list)) list = [list];
  return list.length + ":" + list[0];
}

function counted(n) {
  let steps = 0;
  while (n > 0 && steps < 5) {
    n -= 2;
    steps++;
  }
  return steps + ":" + n;
}

function nullish(n) {
  n ??= 5;
  return n * 2;
}

function bumped(n) {
  n++;
  return n;
}

function appended(text) {
  text += "!";
  return text;
}

function swapped(a, b) {
  [a, b] = [b, a];
  return a - b;
}

function unpacked(point) {
  ({ x: point } = point);
  return point + 1;
}

function honest(round) {
  console.log(round, orEmpty([1, 2]), orEmpty(), orEmpty([]), orZero(1), orZero(), orZero(0.5), toNumber(1), toNumber(2.5), toInteger(1), toInteger(7));
  console.log(round, toText("abc"), toText(""), wrapped([1, 2]), wrapped([3]), counted(4), counted(5), counted(0), nullish(1), nullish(), nullish(0));
  console.log(round, bumped(1), bumped(0.5), bumped(-1), appended("a"), appended(""), swapped(1, 2), swapped(5, 3), unpacked({ x: 1 }), unpacked({ x: 0.5 }));
}

const impostors = [
  ["a numeric string", () => "3"],
  ["an empty string", () => ""],
  ["a word", () => "word"],
  ["an object with valueOf and toString", () => ({ valueOf: () => (log.push("valueOf"), 3), toString: () => (log.push("toString"), "text"), x: "x" })],
  ["a BigInt", () => 3n],
  ["zero as a BigInt", () => 0n],
  ["an array of one", () => [3]],
  ["an empty array", () => []],
  ["a symbol", () => Symbol.iterator],
  ["two to the 31st", () => 2147483648],
  ["the largest small integer", () => 2147483647],
  ["a fraction", () => 2.5],
  ["negative zero", () => -0],
  ["NaN", () => NaN],
  ["true", () => true],
  ["null", () => null],
  ["undefined", () => undefined],
];

honest("before");
for (const [name, make] of impostors) {
  attempt("orEmpty of " + name, () => orEmpty(make()));
  attempt("orZero of " + name, () => orZero(make()));
  attempt("toNumber of " + name, () => toNumber(make()));
  attempt("toInteger of " + name, () => toInteger(make()));
  attempt("toText of " + name, () => toText(make()));
  attempt("wrapped " + name, () => wrapped(make()));
  attempt("counted from " + name, () => counted(make()));
  attempt("nullish of " + name, () => nullish(make()));
  attempt("bumped " + name, () => bumped(make()));
  attempt("appended to " + name, () => appended(make()));
  attempt("swapped " + name + " and one", () => swapped(make(), 1));
  attempt("unpacked " + name, () => unpacked(make()));
}
honest("after");
