const other = require("./other.cjs");
exports.name = "main";
function ask() {
  return other.seen + " " + other.late();
}
console.log(ask());
