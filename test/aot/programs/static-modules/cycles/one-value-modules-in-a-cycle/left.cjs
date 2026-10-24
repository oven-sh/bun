module.exports = left;
const right = require("./right.cjs");
function left(n) {
  return n <= 0 ? "left" : right(n - 1);
}
