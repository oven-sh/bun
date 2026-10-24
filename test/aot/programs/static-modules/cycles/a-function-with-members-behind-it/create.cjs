module.exports = create;
module.exports.early = "early";
const user = require("./user.cjs");
module.exports.late = "late";
module.exports.create = create;
function create(name) {
  return { name, made: user.made() };
}
