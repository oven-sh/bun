// JSON.stringify takes no type argument
// RUN: link
// DIAGNOSTIC: TS2558 1
// STATISTIC: SourceFilesDemoted = 0

console.log(JSON.stringify<number>(1));
