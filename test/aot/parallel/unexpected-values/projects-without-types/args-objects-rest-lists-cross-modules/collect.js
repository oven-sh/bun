exports.sloppyArguments = function (a, b) {
  return arguments;
};
exports.strictArguments = function (a, b) {
  "use strict";
  return arguments;
};
exports.rest = function (...rest) {
  return rest;
};
exports.aliased = function (a, b) {
  return { operands: arguments, read: function () { return [a, b]; }, write: function (value) { a = value; } };
};
exports.withDefaults = function (a = 0, b) {
  return { operands: arguments, read: function () { return [a, b]; }, write: function (value) { a = value; } };
};
