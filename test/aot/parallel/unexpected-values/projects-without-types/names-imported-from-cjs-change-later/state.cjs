exports.count = 1;
exports.list = [1, 2, 3];
exports.size = function () {
  return exports.list.length;
};
exports.change = function () {
  exports.count = "two";
  exports.list = "a text";
  exports.size = function () {
    return "replaced";
  };
  exports.added = "added late";
};
exports.changeInPlace = function () {
  exports.list.push(4);
};
