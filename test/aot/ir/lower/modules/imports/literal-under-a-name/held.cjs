"use strict";
const held = {
  sum(a, b) {
    let t = 0;
    while (t < 2) t++;
    return a + b + t;
  },
  maker(a) {
    return b => a + b;
  },
  down: function down(n) {
    return n > 0 ? n + down(n - 1) : 0;
  },
};
module.exports = held;
