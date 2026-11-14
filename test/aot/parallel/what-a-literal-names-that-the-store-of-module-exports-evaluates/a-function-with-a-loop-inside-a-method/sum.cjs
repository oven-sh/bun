"use strict";
const held = {
  sum(a, b) {
    function add(n) {
      let t = 0;
      while (n-- > 0) t += a;
      return t;
    }
    return add(b) + [1, 2].map(x => { for (const y of [x]) return y + b; }).join();
  },
};
module.exports = held;
