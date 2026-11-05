module.exports = function first() {
  return "first";
};
exports.lost = "stored on the object that was replaced";
module.exports = function second(value) {
  return "second " + value;
};
