"use strict";
const finder = require("./finder.cjs");
const probe = finder.find("probe");
exports.first = probe.look();
exports.total = 41;
exports.second = probe.look();
