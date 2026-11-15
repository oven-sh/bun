const crate = require("./crate.cjs");
module.exports = { tag: "box" };
module.exports.later = function () {
  return require("./barrel.mjs");
};
