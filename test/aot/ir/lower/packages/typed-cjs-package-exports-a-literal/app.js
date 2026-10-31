// a typed CommonJS package exports a literal
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: AotFilesUsed = 1
// CHECK: entry

const p = require("literal");
console.log(p.x(), p.y);
