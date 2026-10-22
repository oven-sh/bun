import { call, make, same, spoil, tagged, taggedResult } from "./loose.js";

/**
 * @param {unknown} value
 * @returns {string}
 */
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "function";
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

/** @typedef {{ x: number, y: number }} Point */

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

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(same(i)) + sum(make("point")) + call(plusOne, i);
console.log("2000 honest rounds: " + warm);

for (const kind of ["number", "text", "nothing", "list", "point", "texts", "step", "unknown"]) {
  attempt(kind + " as a number", () => {
    /** @type {number} */
    const n = make(kind);
    return [typeof n, n + 1, plusOne(n)];
  });
  attempt(kind + " as a point", () => {
    /** @type {Point} */
    const p = make(kind);
    return [p.x, sum(p)];
  });
  attempt(kind + " as a function", () => {
    /** @type {(n: number) => number} */
    const f = make(kind);
    return f(1) + 1;
  });
}
attempt("tags of the module that is not checked", () => [tagged, tagged + 1, plusOne(tagged), taggedResult(), taggedResult() + 1, plusOne(taggedResult())]);
attempt("tagged functions are called from there", () => [call(plusOne, "1"), call(plusOne), call(sum, { x: "1", y: 2 }), call(sum, [1, 2])]);
attempt("a tagged literal is stored to from there", () => {
  /** @type {Point} */
  const p = { x: 1, y: 2 };
  spoil(p, "x", "text");
  spoil(p, "z", 3);
  return [p.x, sum(p), JSON.stringify(p)];
});
