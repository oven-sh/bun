module.exports = function Point(x, y) {
  return { x: x, y: y, sum: function () { return "plain " + (x + y); } };
};
module.exports.origin = function () {
  return module.exports(0, 0);
};
