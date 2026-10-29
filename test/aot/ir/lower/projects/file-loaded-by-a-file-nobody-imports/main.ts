// a file that only the body of a function in a file that nobody imports loads is part of the project
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

globalThis.declaredElsewhere = 5;
console.log(declaredElsewhere + 1);
