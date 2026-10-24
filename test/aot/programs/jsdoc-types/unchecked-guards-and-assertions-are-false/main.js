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

class Shape {
  sides = 0;
}

class Square extends Shape {
  edge = 2;
  /** @returns {number} */
  area() {
    return this.edge * this.edge;
  }
}

/**
 * @param {unknown} v
 * @returns {v is number}
 */
function isNumber(v) {
  return true;
}

/**
 * @param {unknown} v
 * @returns {v is string}
 */
function isText(v) {
  return v !== null;
}

/**
 * @param {Shape} s
 * @returns {s is Square}
 */
function isSquare(s) {
  return s.sides === 0;
}

/**
 * @param {unknown} v
 * @returns {v is { x: number, y: number }}
 */
function isPoint(v) {
  return typeof v === "object";
}

/**
 * @param {unknown} v
 * @returns {v is number[]}
 */
function isList(v) {
  return Object(v).length !== undefined;
}

/**
 * @param {unknown} v
 * @returns {asserts v is number}
 */
function assertNumber(v) {}

/**
 * @param {unknown} v
 * @returns {asserts v}
 */
function assertPresent(v) {}

/**
 * @param {Shape} s
 * @returns {asserts s is Square}
 */
function assertSquare(s) {}

/** @param {unknown} v */
function plusOne(v) {
  return isNumber(v) ? v + 1 : "no number";
}

/** @param {unknown} v */
function size(v) {
  return isText(v) ? v.length : "no text";
}

/** @param {Shape} s */
function area(s) {
  return isSquare(s) ? [s.edge, s.edge * 2, s.area()] : "no square";
}

/** @param {Shape} s */
function edge(s) {
  return isSquare(s) ? [s.edge, s.edge * 2] : "no square";
}

/** @param {unknown} v */
function sum(v) {
  return isPoint(v) ? v.x + v.y : "no point";
}

/** @param {unknown} v */
function total(v) {
  if (!isList(v)) return "no list";
  let result = 0;
  for (let i = 0; i < v.length; i++) result += v[i];
  return result;
}

/** @param {unknown} v */
function asserted(v) {
  assertNumber(v);
  return [v + 1, v * 2, typeof v];
}

/** @param {{ x: number } | null | undefined} p */
function present(p) {
  assertPresent(p);
  return p.x;
}

/** @param {Shape} s */
function assertedEdge(s) {
  assertSquare(s);
  return [s.edge, s.edge * 2];
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + size("ab") + edge(new Square())[1] + sum({ x: i, y: 1 }) + total([i]) + asserted(i)[0] + present({ x: i }) + assertedEdge(new Square())[0];
console.log("2000 honest rounds: " + warm);

attempt("a guard for numbers", () => [plusOne(1), plusOne("1"), plusOne(null), plusOne(undefined), plusOne([1]), plusOne({})]);
attempt("a guard for texts", () => [size("ab"), size([1, 2, 3]), size(5), size({ length: "long" }), size(null)]);
attempt("a guard for texts, undefined", () => size(undefined));
attempt("a guard for a subclass, its field", () => [edge(new Square()), edge(new Shape())]);
attempt("a guard for a subclass, its method", () => area(new Shape()));
attempt("a guard for points", () => [sum({ x: 1, y: 2 }), sum({ x: "1", y: 2 }), sum([1, 2]), sum({}), sum(5)]);
attempt("a guard for points, null", () => sum(null));
attempt("a guard for lists", () => [total([1, 2]), total("12"), total({ length: 2, 0: 1, 1: "2" }), total(() => 1), total(5)]);
attempt("an assertion for numbers", () => [asserted(1), asserted("1"), asserted(null), asserted([2])]);
attempt("an assertion that something is there", () => present({ x: 1 }));
attempt("an assertion that something is there, null", () => present(null));
attempt("an assertion that something is there, undefined", () => present(undefined));
attempt("an assertion for a subclass", () => [assertedEdge(new Square()), assertedEdge(new Shape())]);
attempt("a guard in filter", () => [1, "2", null, [3]].filter(isNumber).map(n => n + 1));
attempt("a guard in find", () => {
  const found = ["a", 1].find(isNumber);
  return [found, found + 1];
});
