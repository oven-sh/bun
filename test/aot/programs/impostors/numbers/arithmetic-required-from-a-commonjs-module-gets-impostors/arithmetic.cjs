var hidden = 0;

exports.add = function (a, b) {
  return a + b;
};

exports.scale = function scale(value, factor) {
  return value * factor;
};

exports.bucket = function (value) {
  return value & 15;
};

exports.next = function (value) {
  return value + 1;
};

exports.counter = 0;

exports.bump = function () {
  exports.counter++;
  return ++hidden;
};

exports.read = function () {
  return hidden;
};

exports.viaExports = function () {
  return [this.counter * 2, exports.counter & 7];
};
