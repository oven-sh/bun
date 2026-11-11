let calls = 0;
exports.who = function () {
  return this;
};
exports.count = () => ++calls;
exports.rate = 3;
