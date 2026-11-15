"use strict";
const step = 2;
let calls = 0;
function note() {
  return ++calls;
}
const held = {
  sum(a, b) {
    for (let i = 0; i < step; i++) note();
    return a + b + calls;
  },
  calls: () => calls,
};
module.exports = held;
