module.exports = { t9: "m9" };
module.exports.late9 = function () {
  return require("./m8.cjs");
};
