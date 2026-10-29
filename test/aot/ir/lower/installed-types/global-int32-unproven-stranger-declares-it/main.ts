// Bun.int32 is a 32-bit integer: an argument that is not proven to be one stops the build
// RUN: link
// DIAGNOSTIC: UnprovenInt32 1
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

/// <reference path="./imports/stranger.d.ts" />
declare const console: { log(...values: unknown[]): void };
function half(n: Bun.int32): number {
  return n / 2;
}
const given: number[] = JSON.parse("[4, 1.5]");
for (const n of given) console.log(half(n));
console.log(typeof Bun.inspect);
