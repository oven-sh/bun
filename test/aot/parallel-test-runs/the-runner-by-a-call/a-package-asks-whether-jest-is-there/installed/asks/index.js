var jestIsDefined = typeof jest !== "undefined";
exports.isTested = function () {
  return jestIsDefined;
};
