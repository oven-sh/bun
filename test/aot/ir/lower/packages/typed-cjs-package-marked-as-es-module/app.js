// a typed CommonJS package is marked as an ES module
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

const p = require("marked");
console.log(p.x(), p.y);
