exports.name = "lib";
exports.count = 0;
exports.next = function () {
  return ++exports.count;
};
