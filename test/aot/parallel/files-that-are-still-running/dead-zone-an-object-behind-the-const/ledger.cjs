"use strict";
const probe = require("./probe.mjs");
exports.get = function () { return table; };
exports.first = probe.look();
const table = { a: 7 };
exports.second = probe.look();
