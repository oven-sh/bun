exports.add = function (a, b) {
  return a + b;
};
exports.double = function (a) {
  return a * 2;
};
exports.either =
  Date.now() < 0
    ? function (a) {
        return a;
      }
    : function (a) {
        return a + 1;
      };
exports.largest = Math.max;
