/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ kind: "circle", r: number } | { kind: "square", side: number }} Shape */

class Animal {
  legs = 4;
}

class Dog extends Animal {
  name = "rex";
  /** @returns {string} */
  bark() {
    return this.name + "!";
  }
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(show).join(", ") + "]";
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

/**
 * @param {string} label
 * @param {() => unknown} run
 */
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
 * @param {Point} p
 * @returns {number}
 */
function sum(p) {
  return p.x + p.y;
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function asNumber(value) {
  return /** @type {number} */ (value);
}

/**
 * @param {unknown} value
 * @returns {Point}
 */
function asPoint(value) {
  return /** @type {Point} */ (value);
}

/**
 * @param {Shape} shape
 * @returns {number}
 */
function radius(shape) {
  return /** @type {Extract<Shape, { kind: "circle" }>} */ (shape).r;
}

/**
 * @param {Animal} animal
 * @returns {string}
 */
function bark(animal) {
  return /** @type {Dog} */ (animal).bark();
}

/**
 * @param {Animal} animal
 * @returns {string}
 */
function nameOf(animal) {
  return /** @type {Dog} */ (animal).name + "?";
}

/**
 * @param {number | undefined} n
 * @returns {number}
 */
function present(n) {
  return /** @type {number} */ (n) + 1;
}

/**
 * @param {string | number} v
 * @returns {number}
 */
function sizeOf(v) {
  return /** @type {string} */ (v).length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(asNumber(i)) + sum(asPoint({ x: i, y: 1 })) + radius({ kind: "circle", r: i }) + bark(new Dog()).length + present(i) + sizeOf("ab");
console.log("2000 honest rounds: " + warm);

for (const value of [1, "1", null, undefined, true, [1], { valueOf: () => 1 }, { x: 1, y: 2 }, { x: "1", y: "2" }, { y: 1 }]) {
  attempt("as a number, " + show(value), () => [asNumber(value) + 1, plusOne(asNumber(value)), typeof asNumber(value)]);
  attempt("as a point, " + show(value), () => [asPoint(value).x, sum(asPoint(value))]);
}

attempt("the radius of a square", () => [radius({ kind: "square", side: 2 }), radius({ kind: "square", side: 2 }) + 1]);
attempt("an animal barks", () => bark(new Animal()));
attempt("the name of an animal", () => nameOf(new Animal()));
attempt("present, and it is not", () => present(undefined));
attempt("the size of a number", () => [sizeOf(5), sizeOf(5) + 1]);

attempt("through unknown, in sight", () => {
  const n = /** @type {number} */ (/** @type {unknown} */ ("12"));
  const p = /** @type {Point} */ (/** @type {unknown} */ ([1, 2]));
  const f = /** @type {() => number} */ (/** @type {unknown} */ ({ call: 1 }));
  return [n + 1, typeof n, p.x, sum(p), typeof f];
});
attempt("a function that is none, called", () => /** @type {() => number} */ (/** @type {unknown} */ ({ call: 1 }))());
attempt("a list that is a text", () => {
  const list = /** @type {number[]} */ (/** @type {unknown} */ ("12"));
  let total = 0;
  for (const n of list) total += n;
  return [total, list.length];
});
attempt("an empty literal as a point", () => {
  const p = /** @type {Point} */ ({});
  const before = [p.x, sum(p), Object.keys(p).join()];
  p.y = 2;
  p.x = 1;
  return [before, sum(p), Object.keys(p).join()];
});
attempt("const, and then stored to through another name", () => {
  const fixed = /** @type {const} */ ({ level: 3 });
  /** @type {{ level: number }} */
  const open = fixed;
  open.level = 4;
  return [fixed.level, fixed.level === 3, fixed.level + 1];
});

console.log("honest again: " + [plusOne(asNumber(1)), sum(asPoint({ x: 1, y: 2 })), bark(new Dog())].join(" "));

export {};
