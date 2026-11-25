"use strict";
const held = {
  sum(a, b) {
    let t = 0;
    while (t < 2) t++;
    return a + b + t;
  },
};
module.exports = held;
