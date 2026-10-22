function load() {
  return require("./b.cjs");
}
exports.early = 1;
const b = load();
exports.late = 2;
exports.saw = b.saw;
