exports.count = 0;
exports.label = "none";
exports.isOn = false;
exports.bump = function bump() {
  exports.count++;
  return exports.count;
};
exports.rename = function rename(to) {
  exports.label += to;
  return exports.label;
};
exports.flip = function flip() {
  exports.isOn = !exports.isOn;
  return exports.isOn;
};
exports.read = function read() {
  return [exports.count, exports.label, exports.isOn];
};
