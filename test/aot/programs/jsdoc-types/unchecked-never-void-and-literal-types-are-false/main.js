function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label, run) {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

/** @returns {never} */
function fail() {
  return "came back";
}

/** @returns {never} */
const failArrow = () => 1;

class Thrower {
  /** @returns {never} */
  fail() {
    return "came back";
  }
}

function afterACall() {
  fail();
  return "the statement after the call ran";
}

function afterAMethod() {
  new Thrower().fail();
  return "the statement after the method ran";
}

function resultOfNever() {
  const result = fail();
  return [result, typeof result, result + "!"];
}

/** @param {number | undefined} n */
function narrowedByNever(n) {
  if (n === undefined) fail();
  return n + 1;
}

/** @param {string | number} v */
function bothBranches(v) {
  if (typeof v === "string") return "text";
  if (typeof v === "number") return "number";
  return "neither: " + typeof v;
}

/** @param {"a" | "b"} mode */
function exhaustive(mode) {
  switch (mode) {
    case "a":
      return 1;
    case "b":
      return 2;
  }
  return "fell through with " + mode;
}

function loopThatNeverEnds() {
  let rounds = 0;
  for (;;) {
    rounds++;
    if (rounds === 3) break;
    fail();
  }
  return rounds;
}

/** @type {never} */
const impossible = "here";

/** @type {void} */
const empty = 3;

/** @type {null} */
const nil = { x: 1 };

/** @type {undefined} */
const missing = 7;

/** @type {5} */
const five = 6;

/** @type {true} */
const on = false;

/** @type {false} */
const off = 1;

/** @type {"a"} */
const mode = "b";

/** @type {1 | 2} */
const level = 3;

/** @type {0} */
const zero = -0;

/** @type {{ kind: "fixed", size: 4 }} */
const fixed = { kind: "loose", size: 5 };

/** @type {readonly [1, 2]} */
const pair = [3, 4, 5];

/** @type {unique symbol} */
const unique = "no symbol";

/** @param {5} n */
function takesFive(n) {
  return [n, n + 1, n === 5];
}

/** @param {true} flag */
function takesTrue(flag) {
  return flag ? "then" : "else";
}

/** @returns {5} */
function givesFive() {
  return 6;
}

attempt("after a call that never returns", afterACall);
attempt("after a method that never returns", afterAMethod);
attempt("after an arrow that never returns", () => {
  failArrow();
  return "the statement after the arrow ran";
});
attempt("the result of never", resultOfNever);
attempt("narrowed by never", () => [narrowedByNever(1), narrowedByNever(undefined)]);
attempt("neither branch", () => [bothBranches("a"), bothBranches(1), bothBranches(true), bothBranches(null)]);
attempt("an exhaustive switch", () => [exhaustive("a"), exhaustive("b"), exhaustive("c"), exhaustive(1)]);
attempt("a loop", loopThatNeverEnds);
attempt("a value of type never", () => [typeof impossible, impossible, impossible + "!", impossible.length]);
attempt("a value of type void", () => [typeof empty, empty, empty + 1, empty === undefined]);
attempt("a value of type null", () => [typeof nil, nil === null, nil == null, nil ?? "fallback", nil ? "truthy" : "falsy", nil?.x]);
attempt("a value of type undefined", () => [typeof missing, missing === undefined, missing ?? "fallback", missing + 1, missing ? "truthy" : "falsy"]);
attempt("five", () => [five, five + 1, five === 5, five === 6, five * 2, [0, 1, 2, 3, 4, 5, 6][five], `${five}`]);
attempt("true and false", () => [on, on === true, !on, on ? "then" : "else", off, off === false, !off, off ? "then" : "else", on && "and", off || "or"]);
attempt("a text", () => [mode, mode === "a", mode === "b", mode + "!", mode.length, { a: 1, b: 2 }[mode]]);
attempt("a level", () => [level, level === 1 ? "one" : "two", level + 1]);
attempt("zero", () => [zero, Object.is(zero, 0), 1 / zero]);
attempt("a literal of literals", () => [fixed.kind, fixed.kind === "fixed", fixed.size, fixed.size + 1, fixed.size === 4, JSON.stringify(fixed)]);
attempt("a pair", () => [pair[0], pair[1], pair[0] + pair[1], pair.length, pair.length === 2, pair[2]]);
attempt("a symbol", () => [typeof unique, unique + "!", { [unique]: 1 }]);
attempt("parameters", () => [takesFive(5), takesFive(6), takesFive("5"), takesTrue(true), takesTrue(false), takesTrue(0), takesTrue("no")]);
attempt("a result", () => [givesFive(), givesFive() + 1, givesFive() === 5]);
