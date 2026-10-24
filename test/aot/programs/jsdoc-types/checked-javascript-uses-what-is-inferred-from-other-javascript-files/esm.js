export function variadic() {
  return arguments.length;
}

export class Grown {
  constructor() {
    this.x = 1;
  }
}
/** @returns {number} */
Grown.prototype.extra = function () {
  return this.x + 1;
};

/**
 * @constructor
 * @param {number} n
 */
export function Tagged(n) {
  this.n = n;
}
/** @returns {number} */
Tagged.prototype.next = function () {
  return this.n + 1;
};

/** @param {number} n */
export function Bare(n) {
  this.n = n;
}
