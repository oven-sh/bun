// a function of a typed CommonJS package reads its receiver
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: AotFilesUsed = 1
// CHECK: entry

const p = require("receiver");
console.log(p.x(), p.y);
