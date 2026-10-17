"use strict";
const gatherer = require("./gathers-in-a-cycle");
const { kCycle } = require("./keys-in-a-cycle");
exports.seen = Object.keys(gatherer).length;
exports.readInACycle = function readInACycle(object) { return object[kCycle]; };
