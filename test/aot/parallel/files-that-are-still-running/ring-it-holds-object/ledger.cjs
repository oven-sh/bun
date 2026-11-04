"use strict";
const probe = require("./probe.mjs");
exports.first = probe.look();
exports.total = { a: 7, b: "text" };
exports.second = probe.look();
