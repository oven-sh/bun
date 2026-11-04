"use strict";
const probe = require("./probe.mjs");
exports.get = function () { return total; };
exports.first = probe.look();
const total = 41;
exports.second = probe.look();
