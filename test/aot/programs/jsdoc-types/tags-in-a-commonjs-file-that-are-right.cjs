console.log("strict: " + (/** @this {unknown} */ function () {
  return this === undefined;
})());

/** @typedef {{ x: number, y: number }} Point */

/**
 * @param {Point} p
 * @returns {number}
 */
function sum(p) {
  return p.x + p.y;
}

/**
 * @param {number} n
 * @returns {number}
 */
function plusOne(n) {
  return n + 1;
}
exports.plusOne = plusOne;

/** @type {number} */
exports.limit = 10;

class Pixel {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
exports.Pixel = Pixel;

const path = require("node:path");

/** @type {string} */
const separator = path.posix.sep;

let warm = 0;
for (let i = 0; i < 2000; i++) warm += sum({ x: i, y: 1 }) + plusOne(i) + exports.limit + sum(new exports.Pixel(i, 1)) + separator.length;
console.log("2000 rounds: " + warm);
console.log(Object.keys(exports).join(), typeof module.exports.plusOne, module.exports === exports, sum(new Pixel(1, 2)));
