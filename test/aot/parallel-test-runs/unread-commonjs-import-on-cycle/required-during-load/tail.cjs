module.exports = { mark: "tail" };
module.exports.later = function () {
  return require("./late.mjs");
};
