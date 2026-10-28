/** @param {number} first */
export function Pair(first) {
  this.first = first;
  this.second = 2;
}
Pair.prototype.sum = function () {
  return this.first + this.second;
};
