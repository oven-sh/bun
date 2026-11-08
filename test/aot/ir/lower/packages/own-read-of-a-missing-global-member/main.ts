// the application's own read of a member of globalThis that its lib does not declare is an error
// RUN: link
// DIAGNOSTIC: TS7017 1
// STATISTIC: SourceFilesDemoted = 0

console.log(globalThis.document === undefined);
