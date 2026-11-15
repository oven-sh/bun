"use strict";
const probe = require("./probe.mjs");
exports.first = probe.look();
exports.kMark = Symbol("mark");
exports.second = probe.look();
