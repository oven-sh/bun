"use strict";
let probe;
try { probe = require("./probe.mjs"); } catch { probe = { look() { return "none"; } }; }
exports.first = probe.look();
exports.total = 41;
exports.second = probe.look();
