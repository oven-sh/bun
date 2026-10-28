const { isMap } = require("./kinds.cjs");
function withNames(callee, names) {
  return eval("(function (" + names + ") { return callee.apply(this, arguments); })");
}
module.exports = withNames(isMap, "value");
