const marked = new WeakSet([Object.prototype, Error.prototype]);
exports.isMarked = function (value) {
  return marked.has(value);
};
exports.pick = function (from, key) {
  return from[key];
};
