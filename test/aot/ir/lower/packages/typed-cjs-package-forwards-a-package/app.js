// a typed CommonJS package exports what another package exports
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

const p = require("forwarded");
console.log(p.x(), p.y);
