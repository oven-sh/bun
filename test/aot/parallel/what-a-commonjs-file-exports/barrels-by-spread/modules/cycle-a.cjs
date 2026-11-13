"use strict";
exports.fromA = "a"; module.exports = { ...require("./cycle-b.cjs"), fromA: "A" };
