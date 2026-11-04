"use strict";
const probe = require("./probe.mjs");
exports.first = probe.look();
exports.total = function () { return "called"; };
exports.second = probe.look();
