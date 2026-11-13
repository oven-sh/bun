// a typed CommonJS package exports members of another package
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

const p = require("aliases");
console.log(p.x(), p.y);
