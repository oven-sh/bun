exports.alpha = "alpha";
exports.beta = 2;
exports.gamma = function gamma(n) {
  return n + exports.beta;
};
if (process.argv.length > 100) exports.neverStored = 1;
exports.storeLater = function storeLater() {
  exports.storedLater = "stored later";
};
exports.default = "a property named default";
exports.constructor = function Plain() {};
Object.defineProperty(exports, "hidden", { value: "hidden" });
exports.changeImportedLate = function changeImportedLate() {
  const late = require("./imported-late.cjs");
  late.second = "changed before the import";
  late.added = "added before the import";
  delete late.first;
  return late;
};
