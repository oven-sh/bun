const seen = require("./seen.cjs");
const first = require("./first-of-cycle.cjs");
exports.sawOfFirst = Object.keys(first).join();
exports.seesNow = function () {
  return Object.keys(first).join();
};
seen.push("second ends");
