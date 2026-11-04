"use strict";
const probe = require("./probe.mjs");
exports.first = probe.look();
exports.total = { n: 0 };
exports.second = probe.look();
