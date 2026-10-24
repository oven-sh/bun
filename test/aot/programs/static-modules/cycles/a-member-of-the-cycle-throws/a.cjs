exports.early = 1;
try {
  require("./b.cjs");
} catch (error) {
  exports.caught = error.message;
}
exports.late = 2;
