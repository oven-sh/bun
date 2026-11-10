// a typed CommonJS package assigns to exports
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

const p = require("assignments");
console.log(p.x(), p.y);
