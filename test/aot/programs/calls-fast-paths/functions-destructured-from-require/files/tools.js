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
exports.oneOfThree =
  Date.now() < 0
    ? function (a) {
        return a;
      }
    : Date.now() < 1
      ? function (a) {
          return a + 2;
        }
      : function (a) {
          return a + 3;
        };
exports.largest = Math.max;
