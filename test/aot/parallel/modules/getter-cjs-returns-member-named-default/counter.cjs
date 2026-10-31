exports.default = 1;
exports.change = function () {
  exports.default += 10;
};
exports.readCount = function () {
  return require("./over-a-counter.cjs").default;
};
