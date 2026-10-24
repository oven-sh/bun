const b = require("./b.cjs");
function declared() {
  return "declared";
}
exports.declared = declared;
exports.arrow = () => "arrow";
exports.Class = class {
  kind() {
    return "class";
  }
};
exports.fromB = b.attempts;
