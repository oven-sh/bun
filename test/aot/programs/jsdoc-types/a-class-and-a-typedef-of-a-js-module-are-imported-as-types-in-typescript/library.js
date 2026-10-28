export class Pair {
  /** @param {number} first */
  constructor(first) {
    this.first = first;
    this.second = 2;
  }
  sum() {
    return this.first + this.second;
  }
}
/** @typedef {number} Level */
export const Level = { Low: 1, High: 2 };
