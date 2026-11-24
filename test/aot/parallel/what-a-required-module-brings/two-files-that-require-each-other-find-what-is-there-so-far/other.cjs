const main = require("./main.cjs");
exports.seen = typeof main.name;
exports.late = function () {
  return typeof main.name;
};
