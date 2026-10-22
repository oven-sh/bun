/**
 * @typedef {{ x: number, y: number }} Point
 */

/**
 * @typedef {object} Named
 * @property {string} name
 * @property {Point} at
 */

export class Circle {
  /**
   * @param {Point} center
   * @param {number} r
   */
  constructor(center, r) {
    this.center = center;
    this.r = r;
  }

  /** @returns {number} */
  area() {
    return this.r * this.r * 3;
  }
}

/**
 * @param {Point} a
 * @param {Point} b
 * @returns {Point}
 */
export function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y };
}

export const unit = /** @type {const} */ ({ x: 1, y: 1 });
