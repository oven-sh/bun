exports.a = "first";
require("./below-the-first.cjs");
module.exports = { a: "own" };
