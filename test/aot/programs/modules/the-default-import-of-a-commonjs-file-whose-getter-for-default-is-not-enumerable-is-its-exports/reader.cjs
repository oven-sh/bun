var lib = require("./lib.cjs");
var second = require("./over-a-file-without-the-flag.cjs");
exports.read = function () {
  return [lib.default, second.default];
};
