"use strict";
const probe = require("./probe.mjs");
exports.first = probe.look();
exports.total = new Map([["k", 1]]);
exports.second = probe.look();
