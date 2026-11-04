"use strict";
exports.kA = Symbol("first a");
exports.kB = Symbol("first b");
module.exports = { kA: Symbol("a"), kB: exports.kB };
