module.exports = create;
module.exports.early = "early";
require("./user.cjs");
module.exports.late = "late";
module.exports.twice = n => n * 2;
function create() {
  return "created";
}
