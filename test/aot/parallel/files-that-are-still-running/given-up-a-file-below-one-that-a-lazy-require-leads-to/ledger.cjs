"use strict";
const marks = require("./marks.cjs");
const probe = require("./probe.mjs");
exports.first = probe.look();
exports.total = 40 + marks.step;
exports.second = probe.look() + ":" + typeof marks.kMark;
