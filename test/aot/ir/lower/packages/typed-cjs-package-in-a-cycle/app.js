// a typed CommonJS package requires a file that requires it
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

const p = require("cycle");
console.log(p.x(), p.y);
