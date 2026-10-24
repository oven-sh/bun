/** @typedef {{ id: number }} Row */

exports.named = 1;
exports.fn = function (/** @type {number} */ n) {
  return n + 1;
};
Object.defineProperty(exports, "defined", { value: "defined", enumerable: true });
module.exports.viaModule = "m";
exports.Klass = class Klass {
  constructor() {
    this.k = 1;
  }
};
