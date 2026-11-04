"use strict";
const probe = require("./probe.mjs");
exports.first = probe.look();
exports.total = Symbol("key");
exports.second = probe.look();
