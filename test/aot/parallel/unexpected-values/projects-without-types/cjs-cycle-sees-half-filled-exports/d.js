var c = require("./c");
exports.kindNow = function () {
  return c.kind;
};
exports.sizeNow = function () {
  return c.list.length;
};
exports.pushNow = function () {
  return c.list.push(2);
};
exports.callNow = function () {
  return c();
};
exports.freshKind = function () {
  return require("./c").kind;
};
exports.freshPush = function () {
  return require("./c").list.push(2);
};
exports.freshCall = function () {
  return require("./c")();
};
