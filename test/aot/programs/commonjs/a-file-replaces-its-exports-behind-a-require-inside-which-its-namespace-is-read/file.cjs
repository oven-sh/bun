exports.early = "first";
require("./module.mjs");
module.exports = { early: "second", late: "late" };
