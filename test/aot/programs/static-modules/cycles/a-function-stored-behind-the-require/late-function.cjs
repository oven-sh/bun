const holder = require("./holder.cjs");
module.exports = function late() {
  return "late";
};
module.exports.member = holder.sawType;
