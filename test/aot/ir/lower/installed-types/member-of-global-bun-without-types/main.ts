// without the types the build goes on
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

declare const console: { log(...values: unknown[]): void };
console.log(typeof Bun.file);
