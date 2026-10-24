const left = require("./late-left.cjs");
module.exports = function right(n) {
  return n <= 0 ? "right" : left(n - 1);
};
