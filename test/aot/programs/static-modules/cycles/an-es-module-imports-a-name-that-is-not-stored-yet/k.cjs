exports.early = 1;
try {
  require("./e.mjs");
  exports.outcome = "loaded";
} catch (error) {
  exports.outcome = error.constructor.name;
}
exports.late = 2;
