"use strict";
const name = (0, eval)("'./probe.cjs'");
const probe = require(name);
exports.first = probe.seen;
exports.total = 41;
