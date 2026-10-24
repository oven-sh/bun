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

const letters = ["a", "b", "c", "d", "e", "f", "g", "h"];

function forOrZero(value, which, text) {
  if (which === 1) return 2147483648;
  if (which === 2) return (0, eval)(text);
  return value;
}

function orZero(value, which, text) {
  return forOrZero(value, which, text) | 0;
}

function forShifted(value, which, text) {
  if (which === 1) return 4294967297;
  if (which === 2) return (0, eval)(text);
  return value;
}

function shifted(value, which, text) {
  return forShifted(value, which, text) >> 1;
}

function forMasked(value, which, text) {
  if (which === 1) return 1.5;
  if (which === 2) return (0, eval)(text);
  return value;
}

function masked(value, which, text) {
  return forMasked(value, which, text) & 3;
}

function forUnsigned(value, which, text) {
  if (which === 1) return -0;
  if (which === 2) return (0, eval)(text);
  return value;
}

function unsigned(value, which, text) {
  return forUnsigned(value, which, text) >>> 0;
}

function forInverted(value, which, text) {
  if (which === 1) return NaN;
  if (which === 2) return (0, eval)(text);
  return value;
}

function inverted(value, which, text) {
  return ~forInverted(value, which, text);
}

function forShiftedLeft(value, which, text) {
  if (which === 1) return "1";
  if (which === 2) return (0, eval)(text);
  return value;
}

function shiftedLeft(value, which, text) {
  return forShiftedLeft(value, which, text) << 28;
}

function forLetterAt(value, which, text) {
  if (which === 1) return "length";
  if (which === 2) return (0, eval)(text);
  return value;
}

function letterAt(value, which, text) {
  return letters[forLetterAt(value, which, text)];
}

function forCharacterAt(value, which, text) {
  if (which === 1) return 1n;
  if (which === 2) return (0, eval)(text);
  return value;
}

function characterAt(value, which, text) {
  return "abcdefgh".charAt(forCharacterAt(value, which, text));
}

function forCodeAt(value, which, text) {
  if (which === 1) return undefined;
  if (which === 2) return (0, eval)(text);
  return value;
}

function codeAt(value, which, text) {
  return "abcdefgh".charCodeAt(forCodeAt(value, which, text));
}

function forSliced(value, which, text) {
  if (which === 1) return -1;
  if (which === 2) return (0, eval)(text);
  return value;
}

function sliced(value, which, text) {
  return letters.slice(forSliced(value, which, text)).length;
}

function forLooped(value, which, text) {
  if (which === 1) return Infinity;
  if (which === 2) return (0, eval)(text);
  return value;
}

function looped(value, which, text) {
  let n = 0;
  for (let i = 0, end = forLooped(value, which, text); i < end && n < 10; i++) n++;
  return n;
}

function forMadeArray(value, which, text) {
  if (which === 1) return null;
  if (which === 2) return (0, eval)(text);
  return value;
}

function madeArray(value, which, text) {
  return new Array(forMadeArray(value, which, text)).length;
}

const hidden = [
  "2147483648",
  "4294967297",
  "-2147483649",
  "1.5",
  "-0",
  "NaN",
  "Infinity",
  "\"1\"",
  "\"length\"",
  "1n",
  "undefined",
  "null",
  "({ valueOf() { return 2; }, toString() { return \"3\"; } })",
  "[1]",
  "-1",
];

function honest(round) {
  console.log(round, "orZero", show(orZero(7)), show(orZero(1)), show(orZero(0)), show(orZero(3)), show(orZero(5)));
  console.log(round, "shifted", show(shifted(7)), show(shifted(1)), show(shifted(0)), show(shifted(3)), show(shifted(5)));
  console.log(round, "masked", show(masked(7)), show(masked(1)), show(masked(0)), show(masked(3)), show(masked(5)));
  console.log(round, "unsigned", show(unsigned(7)), show(unsigned(1)), show(unsigned(0)), show(unsigned(3)), show(unsigned(5)));
  console.log(round, "inverted", show(inverted(7)), show(inverted(1)), show(inverted(0)), show(inverted(3)), show(inverted(5)));
  console.log(round, "shiftedLeft", show(shiftedLeft(7)), show(shiftedLeft(1)), show(shiftedLeft(0)), show(shiftedLeft(3)), show(shiftedLeft(5)));
  console.log(round, "letterAt", show(letterAt(7)), show(letterAt(1)), show(letterAt(0)), show(letterAt(3)), show(letterAt(5)));
  console.log(round, "characterAt", show(characterAt(7)), show(characterAt(1)), show(characterAt(0)), show(characterAt(3)), show(characterAt(5)));
  console.log(round, "codeAt", show(codeAt(7)), show(codeAt(1)), show(codeAt(0)), show(codeAt(3)), show(codeAt(5)));
  console.log(round, "sliced", show(sliced(7)), show(sliced(1)), show(sliced(0)), show(sliced(3)), show(sliced(5)));
  console.log(round, "looped", show(looped(7)), show(looped(1)), show(looped(0)), show(looped(3)), show(looped(5)));
  console.log(round, "madeArray", show(madeArray(7)), show(madeArray(1)), show(madeArray(0)), show(madeArray(3)), show(madeArray(5)));
}

honest("before");
attempt("orZero, the other path in sight", () => orZero(undefined, 1));
for (const text of hidden) attempt("orZero of " + text, () => orZero(undefined, 2, text));
attempt("shifted, the other path in sight", () => shifted(undefined, 1));
for (const text of hidden) attempt("shifted of " + text, () => shifted(undefined, 2, text));
attempt("masked, the other path in sight", () => masked(undefined, 1));
for (const text of hidden) attempt("masked of " + text, () => masked(undefined, 2, text));
attempt("unsigned, the other path in sight", () => unsigned(undefined, 1));
for (const text of hidden) attempt("unsigned of " + text, () => unsigned(undefined, 2, text));
attempt("inverted, the other path in sight", () => inverted(undefined, 1));
for (const text of hidden) attempt("inverted of " + text, () => inverted(undefined, 2, text));
attempt("shiftedLeft, the other path in sight", () => shiftedLeft(undefined, 1));
for (const text of hidden) attempt("shiftedLeft of " + text, () => shiftedLeft(undefined, 2, text));
attempt("letterAt, the other path in sight", () => letterAt(undefined, 1));
for (const text of hidden) attempt("letterAt of " + text, () => letterAt(undefined, 2, text));
attempt("characterAt, the other path in sight", () => characterAt(undefined, 1));
for (const text of hidden) attempt("characterAt of " + text, () => characterAt(undefined, 2, text));
attempt("codeAt, the other path in sight", () => codeAt(undefined, 1));
for (const text of hidden) attempt("codeAt of " + text, () => codeAt(undefined, 2, text));
attempt("sliced, the other path in sight", () => sliced(undefined, 1));
for (const text of hidden) attempt("sliced of " + text, () => sliced(undefined, 2, text));
attempt("looped, the other path in sight", () => looped(undefined, 1));
for (const text of hidden) attempt("looped of " + text, () => looped(undefined, 2, text));
attempt("madeArray, the other path in sight", () => madeArray(undefined, 1));
for (const text of hidden) attempt("madeArray of " + text, () => madeArray(undefined, 2, text));
honest("after");
