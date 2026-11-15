globalThis.firstExports = exports;
globalThis.moduleOfTheSameObject = module;
exports.a = 1;
module.exports = exports;
exports.b = 2;
module.exports.c = 3;
exports.tell = function tell() {
  return "told by the module";
};
exports.storeLate = function storeLate(value) {
  module.exports.late = value;
  return `${typeof module.exports} ${exports.late}`;
};
