const seen = require("./seen.cjs");
seen.push("replaced runs");
exports.lost = true;
module.exports = function (x) {
  return x * 21;
};
module.exports.kept = Object.keys(exports).join();
seen.push("replaced: " + module.exports.kept + " " + typeof module.exports);
