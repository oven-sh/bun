/** @typedef {{ x: number, y: number }} Point */

/**
 * @param {Point} p
 * @returns {number}
 */
export function sum(p) {
  return p.x + p.y;
}

export class Pixel {
  /**
   * @param {number} x
   * @param {number} y
   */
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }
}
