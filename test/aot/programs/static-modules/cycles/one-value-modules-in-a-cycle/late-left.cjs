const right = require("./late-right.cjs");
module.exports = function left(n) {
  return n <= 0 ? "left" : right(n - 1);
};
