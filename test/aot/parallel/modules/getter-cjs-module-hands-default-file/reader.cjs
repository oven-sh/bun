var lib = require("./lib.cjs");
var renamed = require("./renamed.cjs");
var marked = require("./over-the-flag.cjs");
exports.read = function () {
  return [lib.default, renamed.taken, marked.default];
};
