ran.push("leaf-eight begins");
const inner = require("./inner.mjs");
ran.push("leaf-eight ends");
exports.eight = "eight+" + inner.inner;
