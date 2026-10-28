const size = 60;
const text = "text";
exports.read = function (value) {
  return value(size);
};
exports.readSecond = function () {
  return text.missing.deeper;
};
