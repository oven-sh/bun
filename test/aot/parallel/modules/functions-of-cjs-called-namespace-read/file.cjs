exports.readsAnother = function () {
  return this.value;
};
exports.callsAnother = function () {
  return this.plain();
};
exports.listsAll = function () {
  return Object.keys(this).join() + " " + typeof this.default;
};
exports.plain = function () {
  return "plain";
};
exports.value = 1;
