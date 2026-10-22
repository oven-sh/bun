/** @typedef {{ x: number, y: number }} Point */
/** @typedef {{ kind: "circle", r: number } | { kind: "square", side: number }} Shape */

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
 * @param {number | undefined} n
 * @returns {number}
 */
function present(n) {
  return /** @type {number} */ (n) + 1;
}

const tuple = /** @type {const} */ ([1, "two"]);
const fixed = /** @type {const} */ ({ mode: "fast", level: 3 });
const list = /** @type {number[]} */ ([]);
const table = /** @type {Record<string, number>} */ ({});
const nothing = /** @type {Point | null} */ (null);
const nested = /** @type {Point} */ (/** @type {unknown} */ ({ x: 1, y: 2 }));

let warm = 0;
for (let i = 0; i < 2000; i++) {
  list.push(i);
  table["k" + (i % 3)] = i;
  warm += asNumber(i) + asPoint({ x: i, y: 1 }).x + radius({ kind: "circle", r: i }) + present(i) + tuple[0] + fixed.level + nested.y;
}
console.log("2000 rounds: " + warm);
console.log(list.length, list[1999] + 1, Object.keys(table).join(), table.k0 + 1, nothing === null, tuple[1].length, fixed.mode.length);
console.log(asNumber(1.5) * 2, JSON.stringify(asPoint({ x: 1, y: 2 })), (/** @type {string} */ (/** @type {unknown} */ ("ab"))).length);

export {};
