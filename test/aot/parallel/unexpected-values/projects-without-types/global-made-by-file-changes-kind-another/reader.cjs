exports.next = function () {
  return counter + 1;
};
exports.kind = function () {
  return typeof counter;
};
exports.size = function () {
  return registry.length;
};
exports.add = function () {
  return registry.push("added");
};
exports.throughTheGlobalObject = function () {
  return [globalThis.counter, "counter" in globalThis, Object.getOwnPropertyDescriptor(globalThis, "counter")];
};
