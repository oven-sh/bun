// Bun.int32 is a 32-bit integer
// RUN: link
// STATISTIC: SourceFilesDemoted = 0
// CHECK: entry

declare const console: { log(...values: unknown[]): void };
function half(n: Bun.int32): number {
  return n / 2;
}
const given: number[] = JSON.parse("[4, 1.5]");
for (const n of given) console.log(half(n | 0));
console.log(typeof Bun.inspect);
