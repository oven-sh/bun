counter = 0;
registry = [];
exports.bump = function () {
  counter++;
  registry.push(counter);
  return counter;
};
exports.become = function (value) {
  counter = value;
};
exports.replaceRegistry = function (value) {
  registry = value;
};
exports.remove = function () {
  return [delete globalThis.counter, delete globalThis.registry];
};
