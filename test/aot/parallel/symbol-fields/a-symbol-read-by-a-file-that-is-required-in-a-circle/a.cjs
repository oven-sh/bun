exports.early = function (o) { return o[key]; };
const b = require("./b.cjs");
var key = Symbol("key");
exports.key = key;
exports.seenByB = b.seen;
exports.late = function (o) { return o[key]; };
