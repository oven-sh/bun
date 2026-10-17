import { heapStats } from "bun:jsc";
function fill(held: bigint[], turns: number): void {
  for (let i = 0; i < turns; i++) held.push(0xffffffffn);
}
const held: bigint[] = [];
Bun.gc(true);
const before = heapStats().objectTypeCounts.BigInt ?? 0;
fill(held, 20_000);
Bun.gc(true);
const made = (heapStats().objectTypeCounts.BigInt ?? 0) - before;
console.log(held.length, held[0] === held[19_999], made < 100 ? "one cell for one literal" : "a cell at every evaluation: " + made);
function mask(hash: bigint): number {
  return Number(hash & 0xffffffffn);
}
console.log(mask(0x1_2345_6789n), mask(-1n), 10n ** 20n, -5n, 0n === -0n, typeof 1n, 0b101n + 0o7n + 0xfn, BigInt.asUintN(8, 257n));
