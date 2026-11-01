var index = require("./index.cjs");
var getter = require("./getter.cjs");
var over = require("./getter-over-the-wrapper.cjs");
exports.read = function () {
  return [index.default, getter.taken, over.taken];
};
