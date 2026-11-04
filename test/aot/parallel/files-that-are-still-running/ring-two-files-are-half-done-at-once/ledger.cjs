"use strict";
const annex = require("./annex.cjs");
const probe = require("./probe.mjs");
exports.first = probe.look();
exports.total = 41;
exports.second = probe.look() + "/" + annex.count;
