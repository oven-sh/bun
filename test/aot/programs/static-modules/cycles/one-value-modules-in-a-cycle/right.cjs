module.exports = right;
const left = require("./left.cjs");
function right(n) {
  return n <= 0 ? "right" : left(n - 1);
}
