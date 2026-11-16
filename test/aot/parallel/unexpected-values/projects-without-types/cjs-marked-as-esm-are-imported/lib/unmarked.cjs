exports.default = function (x, y) {
  return { sum: () => "unmarked " + (x + y) };
};
exports.origin = function () {
  return { sum: () => "unmarked origin" };
};
