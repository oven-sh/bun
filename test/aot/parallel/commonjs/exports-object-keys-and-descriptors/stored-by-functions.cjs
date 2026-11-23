const alias = exports;
exports.fill = function fill() {
  exports.second = 2;
  this.viaThis = 3;
  exports.first = exports.first + 1;
};
exports.first = 1;
exports.storeWrittenFirst = function storeWrittenFirst() {
  exports.writtenFirst = "stored second";
};
exports.storeWrittenSecond = function storeWrittenSecond() {
  module.exports.writtenSecond = "stored first";
};
exports.storeThroughAlias = () => {
  alias.throughAlias = "alias";
  this.throughThisOfArrow = "this";
};
exports.storeByName = function storeByName(name, value) {
  exports[name] = value;
};
exports.define = function define() {
  Object.defineProperty(exports, "definedGetter", { enumerable: true, get() { return exports.first; } });
  Object.defineProperty(exports, "definedFixed", { value: "fixed" });
  exports.definedFixed = "ignored in sloppy code";
};
exports.remove = function remove() {
  return [delete exports.second, delete exports.definedFixed, delete exports.absent, delete exports.neverStored].join();
};
exports.storeNever = function storeNever() {
  exports.neverStored = 1;
};
exports.fillLater = async function fillLater() {
  exports.beforeAwait = 1;
  await null;
  exports.afterAwait = 2;
  return Object.keys(exports).slice(-2).join();
};
