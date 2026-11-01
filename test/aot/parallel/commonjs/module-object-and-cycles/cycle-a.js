countRun("cycle-a");
exports.discarded = true;
module.exports = {
  early: "a early",
  listBKeys: () => Object.keys(require("./cycle-b.js")).join(),
};
const b = require("./cycle-b.js");
module.exports.late = "a late";
module.exports.b = b;
