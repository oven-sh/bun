"use strict";
exports.get = get;
const probe = require("./probe.mjs");
exports.first = probe.look();
let total = 41;
exports.second = probe.look();
function get() { return total + 1; }
