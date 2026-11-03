// util.deprecate() copies the descriptor of "length": redefined, deleted, or an accessor.
const util = require("node:util");
const describe = fn =>
  JSON.stringify(Object.getOwnPropertyDescriptor(util.deprecate(fn, "deprecated"), "length"), (key, value) =>
    typeof value === "function" ? "function" : value,
  );
const redefined = function (a) {};
Object.defineProperty(redefined, "length", { value: 9, writable: true, enumerable: true });
const deleted = function (a) {};
delete deleted.length;
const computed = function (a) {};
Object.defineProperty(computed, "length", { get: () => 7, configurable: true });
console.log(
  describe(function (a, b) {}),
  describe(function (a, b, c) {}.bind(null, 1)),
  describe(redefined),
  describe(deleted),
  describe(computed),
  util.deprecate(computed, "deprecated").length,
);
