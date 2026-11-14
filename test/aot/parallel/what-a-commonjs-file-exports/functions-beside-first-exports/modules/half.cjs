"use strict";
const seen = require("./half-back.cjs");
module.exports = function half(n) { return n; };
module.exports.first = seen.first;
module.exports.second = seen.again();
