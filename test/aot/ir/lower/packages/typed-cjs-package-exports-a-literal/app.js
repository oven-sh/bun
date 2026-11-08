// a typed CommonJS package exports a literal
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

const p = require("literal");
console.log(p.x(), p.y);
