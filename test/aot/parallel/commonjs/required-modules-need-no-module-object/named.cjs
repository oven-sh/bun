const seen = require("./seen.cjs");
seen.push("named runs");
exports.one = 1;
exports.two = function () {
  return exports.one + 1;
};
