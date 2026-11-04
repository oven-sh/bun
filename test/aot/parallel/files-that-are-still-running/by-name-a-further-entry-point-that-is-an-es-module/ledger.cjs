"use strict";
const name = (0, eval)("'./probe.mjs'");
const probe = require(name);
exports.first = probe.look();
exports.total = 41;
exports.second = probe.look();
