exports.add = function (a, b) {
  return a + b;
};
exports.arrow = () => typeof this.add;
exports.replaced = function () {
  return "first";
};
exports.value = 1;
setTimeout(() => {
  exports.replaced = function () {
    return "second " + this.value;
  };
}, 0);
