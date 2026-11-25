"use strict";
const held = {
  Counter: class {
    start = 1;
    count(n) {
      let t = this.start;
      for (let i = 0; i < n; i++) t += i;
      return t;
    }
    static twice(n) {
      while (n < 10) n *= 2;
      return n;
    }
  },
};
module.exports = held;
