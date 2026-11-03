// a typed CommonJS package exports a function with members
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: AotFilesUsed = 1
// CHECK: entry

const p = require("function");
console.log(p.x(), p.y);
