"use strict";
const held = {
  sum: function (a, b) {
    for (let i = 0; i < 3; i++) a += i;
    return a + b;
  },
};
module.exports = held;
