"use strict";
const dep = require("./dep.cjs");
exports.kind = "no function";
if (dep.two === 3) module.exports = function late(n) { return n; };
