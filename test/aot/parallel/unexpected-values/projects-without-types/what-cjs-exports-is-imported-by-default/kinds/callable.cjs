module.exports = function callable() {
  return [1, 2, 3];
};
module.exports[0] = 1;
module.exports.toString = function () {
  return "a function as a text";
};
