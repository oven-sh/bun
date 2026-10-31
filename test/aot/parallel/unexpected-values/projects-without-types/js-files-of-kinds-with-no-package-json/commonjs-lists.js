exports.make = function () {
  return { 0: 1, 1: 2, 2: 3, length: "3" };
};
exports.size = function (list) {
  return list.length;
};
exports.mode = (function () {
  return this === undefined ? "strict" : "sloppy";
})();
