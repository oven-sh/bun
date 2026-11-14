// what a file that nobody imports names at its head, and what it declares for other files behind it
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

globalThis.fromTheHead = 7;
globalThis.fromTheRest = 1;
globalThis.fromAnExport = 2;
console.log(fromTheHead + fromTheRest + fromAnExport);
