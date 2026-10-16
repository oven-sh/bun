"use strict";
const keys = require("./stored-to");
const first = keys.kept;
keys.kept = Symbol("second");
const { kept } = require("./stored-to");
exports.first = first;
exports.second = kept;
exports.readOfStoredTo = function readOfStoredTo(object) { return object[kept]; };
