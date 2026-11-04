const before = typeof require;
{ function require() { return "inner"; } }
exports.seen = [before, typeof require, typeof require("node:path").join];
