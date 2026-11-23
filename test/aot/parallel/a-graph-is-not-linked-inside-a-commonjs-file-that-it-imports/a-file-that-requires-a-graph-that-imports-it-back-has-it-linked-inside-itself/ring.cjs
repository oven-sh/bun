(globalThis.order ??= []).push("begin ring");
exports.early = 1;
exports.leaf = require("./util.mjs").util;
exports.seen = require("./back.mjs").seen;
exports.late = 2;
globalThis.order.push("end ring");
