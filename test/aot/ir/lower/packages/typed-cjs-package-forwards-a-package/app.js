// a typed CommonJS package exports what another package exports
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// STATISTIC: AotFilesUsed = 1
// CHECK: entry

const p = require("forwarded");
console.log(p.x(), p.y);
