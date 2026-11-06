var first = require("./over-a-module.cjs");
var second = require("./over-a-commonjs-file.cjs");
var third = require("./over-a-variable.cjs");
exports.read = function () {
  return [first.default, second.default, third.default];
};
