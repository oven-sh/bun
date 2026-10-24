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

function forTimesTwo(value, which, text) {
  if (which === 1) return "7";
  if (which === 2) return (0, eval)(text);
  return value;
}

function timesTwo(value, which, text) {
  return forTimesTwo(value, which, text) * 2;
}

function forMinusOne(value, which, text) {
  if (which === 1) return null;
  if (which === 2) return (0, eval)(text);
  return value;
}

function minusOne(value, which, text) {
  return forMinusOne(value, which, text) - 1;
}

function forPlusOne(value, which, text) {
  if (which === 1) return undefined;
  if (which === 2) return (0, eval)(text);
  return value;
}

function plusOne(value, which, text) {
  return forPlusOne(value, which, text) + 1;
}

function forNegated(value, which, text) {
  if (which === 1) return 7n;
  if (which === 2) return (0, eval)(text);
  return value;
}

function negated(value, which, text) {
  return -forNegated(value, which, text);
}

function forBelowFive(value, which, text) {
  if (which === 1) return [7];
  if (which === 2) return (0, eval)(text);
  return value;
}

function belowFive(value, which, text) {
  return forBelowFive(value, which, text) < 5;
}

function forHalved(value, which, text) {
  if (which === 1) return true;
  if (which === 2) return (0, eval)(text);
  return value;
}

function halved(value, which, text) {
  return forHalved(value, which, text) / 2;
}

function forFloored(value, which, text) {
  if (which === 1) return -0;
  if (which === 2) return (0, eval)(text);
  return value;
}

function floored(value, which, text) {
  return Math.floor(forFloored(value, which, text));
}

function forRemainder(value, which, text) {
  if (which === 1) return NaN;
  if (which === 2) return (0, eval)(text);
  return value;
}

function remainder(value, which, text) {
  return forRemainder(value, which, text) % 4;
}

function forSquared(value, which, text) {
  if (which === 1) return { valueOf: () => 7 };
  if (which === 2) return (0, eval)(text);
  return value;
}

function squared(value, which, text) {
  return forSquared(value, which, text) ** 2;
}

function forIsSeven(value, which, text) {
  if (which === 1) return "seven";
  if (which === 2) return (0, eval)(text);
  return value;
}

function isSeven(value, which, text) {
  return forIsSeven(value, which, text) === 7;
}

function forCounted(value, which, text) {
  if (which === 1) return new Number(7);
  if (which === 2) return (0, eval)(text);
  return value;
}

function counted(value, which, text) {
  let n = forCounted(value, which, text);
  n++;
  return n;
}

function forSummed(value, which, text) {
  if (which === 1) return Symbol.iterator;
  if (which === 2) return (0, eval)(text);
  return value;
}

function summed(value, which, text) {
  let sum = 0;
  sum += forSummed(value, which, text);
  sum += forSummed(value, which, text);
  return sum;
}

const hidden = [
  "\"7\"",
  "\"seven\"",
  "null",
  "undefined",
  "7n",
  "[7]",
  "true",
  "-0",
  "NaN",
  "({ valueOf() { return 7; } })",
  "new Date(7)",
  "Symbol()",
];

function honest(round) {
  console.log(round, "timesTwo", show(timesTwo(7)), show(timesTwo(2.5)), show(timesTwo(-3)), show(timesTwo(0)), show(timesTwo(100)));
  console.log(round, "minusOne", show(minusOne(7)), show(minusOne(2.5)), show(minusOne(-3)), show(minusOne(0)), show(minusOne(100)));
  console.log(round, "plusOne", show(plusOne(7)), show(plusOne(2.5)), show(plusOne(-3)), show(plusOne(0)), show(plusOne(100)));
  console.log(round, "negated", show(negated(7)), show(negated(2.5)), show(negated(-3)), show(negated(0)), show(negated(100)));
  console.log(round, "belowFive", show(belowFive(7)), show(belowFive(2.5)), show(belowFive(-3)), show(belowFive(0)), show(belowFive(100)));
  console.log(round, "halved", show(halved(7)), show(halved(2.5)), show(halved(-3)), show(halved(0)), show(halved(100)));
  console.log(round, "floored", show(floored(7)), show(floored(2.5)), show(floored(-3)), show(floored(0)), show(floored(100)));
  console.log(round, "remainder", show(remainder(7)), show(remainder(2.5)), show(remainder(-3)), show(remainder(0)), show(remainder(100)));
  console.log(round, "squared", show(squared(7)), show(squared(2.5)), show(squared(-3)), show(squared(0)), show(squared(100)));
  console.log(round, "isSeven", show(isSeven(7)), show(isSeven(2.5)), show(isSeven(-3)), show(isSeven(0)), show(isSeven(100)));
  console.log(round, "counted", show(counted(7)), show(counted(2.5)), show(counted(-3)), show(counted(0)), show(counted(100)));
  console.log(round, "summed", show(summed(7)), show(summed(2.5)), show(summed(-3)), show(summed(0)), show(summed(100)));
}

honest("before");
attempt("timesTwo, the other path in sight", () => timesTwo(undefined, 1));
for (const text of hidden) attempt("timesTwo of " + text, () => timesTwo(undefined, 2, text));
attempt("minusOne, the other path in sight", () => minusOne(undefined, 1));
for (const text of hidden) attempt("minusOne of " + text, () => minusOne(undefined, 2, text));
attempt("plusOne, the other path in sight", () => plusOne(undefined, 1));
for (const text of hidden) attempt("plusOne of " + text, () => plusOne(undefined, 2, text));
attempt("negated, the other path in sight", () => negated(undefined, 1));
for (const text of hidden) attempt("negated of " + text, () => negated(undefined, 2, text));
attempt("belowFive, the other path in sight", () => belowFive(undefined, 1));
for (const text of hidden) attempt("belowFive of " + text, () => belowFive(undefined, 2, text));
attempt("halved, the other path in sight", () => halved(undefined, 1));
for (const text of hidden) attempt("halved of " + text, () => halved(undefined, 2, text));
attempt("floored, the other path in sight", () => floored(undefined, 1));
for (const text of hidden) attempt("floored of " + text, () => floored(undefined, 2, text));
attempt("remainder, the other path in sight", () => remainder(undefined, 1));
for (const text of hidden) attempt("remainder of " + text, () => remainder(undefined, 2, text));
attempt("squared, the other path in sight", () => squared(undefined, 1));
for (const text of hidden) attempt("squared of " + text, () => squared(undefined, 2, text));
attempt("isSeven, the other path in sight", () => isSeven(undefined, 1));
for (const text of hidden) attempt("isSeven of " + text, () => isSeven(undefined, 2, text));
attempt("counted, the other path in sight", () => counted(undefined, 1));
for (const text of hidden) attempt("counted of " + text, () => counted(undefined, 2, text));
attempt("summed, the other path in sight", () => summed(undefined, 1));
for (const text of hidden) attempt("summed of " + text, () => summed(undefined, 2, text));
honest("after");
