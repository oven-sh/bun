const seen = require("./seen.cjs");
exports.early = "early";
const second = require("./second-of-cycle.cjs");
exports.late = "late";
exports.describe = function () {
  return second.sawOfFirst + " | " + second.seesNow();
};
seen.push("first ends");
