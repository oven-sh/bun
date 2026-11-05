// JSON.parse takes no type argument
// RUN: link
// DIAGNOSTIC: TS2558 1
// STATISTIC: SourceFilesDemoted = 0

console.log(JSON.parse<number>("1"));
