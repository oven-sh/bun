"use strict";
const own = require("./symbols.cjs");
exports.before = Object.keys(own).join();
exports.kA = Symbol("a");
exports.kB = Symbol("b");
exports.after = Object.keys(own).join();
