"use strict";
const name = (0, eval)("'./probe.cjs'");
const probe = require(name);
exports.first = probe.look();
exports.total = { a: 7, b: "text" };
exports.second = probe.look();
