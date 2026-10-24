function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
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

/**
 * @param {number} n
 * @returns {number}
 */
function plusOne(n) {
  return n + 1;
}

/**
 * @param {number} a
 * @param {number} b
 */
function product(a, b) {
  return a * b;
}

/** @param {{ x: number, y: number }} p */
function sum(p) {
  return p.x + p.y;
}

/** @param {string} s */
function size(s) {
  return s.length;
}

/** @param {number[]} list */
function total(list) {
  let result = 0;
  for (let i = 0; i < list.length; i++) result += list[i];
  return result;
}

/** @param {number[]} list */
function totalOf(list) {
  let result = 0;
  for (const n of list) result += n;
  return result;
}

/** @param {number} i */
function pick(i) {
  return [10, 20, 30][i];
}

/** @param {boolean} b */
function choose(b) {
  return b === true ? "yes" : b === false ? "no" : "neither";
}

/**
 * @param {number} n
 * @param {number} depth
 */
function deep(n, depth) {
  try {
    return depth === 0 ? n + 1 : deep(n, depth - 1);
  } finally {
    depth++;
  }
}

class Meter {
  /** @param {number} start */
  constructor(start) {
    this.value = start;
  }
  /** @param {number} by */
  add(by) {
    this.value += by;
    return this.value;
  }
  /** @param {Meter} other */
  same(other) {
    return this.value === other.value;
  }
}

console.log("honest: " + [plusOne(1), product(2, 3), sum({ x: 1, y: 2 }), size("ab"), total([1, 2]), totalOf([1, 2]), pick(1), choose(true), deep(1, 3), new Meter(1).add(2)].join(" "));
let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + product(i, 2) + sum({ x: i, y: 1 }) + size("ab") + total([i]) + totalOf([i]) + pick(i % 3) + deep(i, 2) + new Meter(i).add(1);
console.log("2000 honest rounds: " + warm);

attempt("plusOne", () => [plusOne("1"), plusOne(null), plusOne(undefined), plusOne(true), plusOne([1]), plusOne({ valueOf: () => 1 }), plusOne({}), plusOne()]);
attempt("plusOne of a bigint", () => plusOne(1n));
attempt("product", () => [product("2", "3"), product("a", 1), product(null, 1), product([2], [3]), product(2), product(-0, 1), product(0, -1)]);
attempt("sum", () => [sum({ x: "1", y: 2 }), sum({ y: 2 }), sum({}), sum([1, 2]), sum("xy"), sum(5), sum(() => 1), sum({ y: 1, x: 2, z: 3 })]);
attempt("sum of null", () => sum(null));
attempt("sum of nothing", () => sum());
attempt("size", () => [size([1, 2, 3]), size({ length: "long" }), size(5), size(() => 1), size((a, b) => 1), size(new String("abc")), size({})]);
attempt("size of null", () => size(null));
attempt("total", () => [total("12"), total({ length: 2, 0: 1, 1: 2 }), total(["1", 2]), total([1, , 3]), total(new Uint8Array([1, 2])), total(5), total({})]);
attempt("totalOf", () => [totalOf("12"), totalOf(new Set([1, "2"])), totalOf(["1", 2]), totalOf([1, , 3]), totalOf(new Map([[1, 2]]))]);
attempt("totalOf something that cannot be iterated", () => totalOf({ length: 1, 0: 1 }));
attempt("pick", () => [pick("1"), pick(1.5), pick(-1), pick(null), pick("length"), pick(true), pick([2]), pick(-0)]);
attempt("choose", () => [choose(1), choose(0), choose("true"), choose(null), choose(), choose(new Boolean(false))]);
attempt("deep", () => [deep("1", 3), deep(null, 0), deep([1], 1), deep(1, "2")]);
attempt("a constructor and a method", () => [new Meter("1").add(2), new Meter(1).add("2"), new Meter().add(1), new Meter(null).add(null), new Meter([1]).add([2])]);
attempt("a method that takes an instance", () => [new Meter(1).same(new Meter(1)), new Meter(1).same({ value: 1 }), new Meter(1).same({}), new Meter(1).same(5), new Meter(undefined).same("text")]);
attempt("a method that takes an instance, null", () => new Meter(1).same(null));

console.log("honest again: " + [plusOne(1), product(2, 3), sum({ x: 1, y: 2 }), size("ab"), total([1, 2]), totalOf([1, 2]), pick(1), choose(false), deep(1, 3), new Meter(1).add(2)].join(" "));
