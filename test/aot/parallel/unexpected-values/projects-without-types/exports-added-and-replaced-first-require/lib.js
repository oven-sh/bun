exports.size = function (list) {
  return list.length;
};
exports.version = 1;
exports.names = ["a", "b"];
exports.gone = "still here";
exports.change = function () {
  exports.size = function (list) {
    return "size " + list.length;
  };
  exports.version = "two";
  exports.names = { 0: "a", length: 1, join: function () { return "own join"; } };
  exports.extra = function () {
    return "extra";
  };
  delete exports.gone;
};
exports.changeBack = function () {
  exports.size = function (list) {
    return list.length;
  };
  exports.version = 3;
  exports.names = ["c"];
};
