exports.plain = function (a) {
  return "plain " + a;
};
exports.storeLate = function () {
  exports.storedLate = function () {
    return "stored late";
  };
};
exports.replaced = function () {
  return "the first";
};
exports.replace = function () {
  exports.replaced = function () {
    return "the second";
  };
};
