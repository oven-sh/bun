// A tree of 1.4 million nodes, built by a function that calls itself: no loop stands around the allocation, and it is made often all the same.
// Measured: 70 MB; 92 MB where the nodes counted as made seldom; 99 MB in plain Bun.
// Kept after a collection, by the engine's own count: 64.0 MB; 85.4 MB in plain Bun.
declare const console: { log(...values: unknown[]): void };
declare const process: { memoryUsage(): { rss: number; heapUsed: number } };
declare const Bun: { gc(isSynchronous: boolean): void };
Bun.gc(true);
const usedBefore = process.memoryUsage().heapUsed;
const before = process.memoryUsage().rss;
type Tree = { first: Tree | null; second: Tree | null; third: Tree | null; fourth: Tree | null; n: number };
function build(depth: number): Tree | null {
  if (!depth) return null;
  return { first: build(depth - 1), second: build(depth - 1), third: build(depth - 1), fourth: build(depth - 1), n: depth };
}
function count(tree: Tree | null): number {
  return tree ? tree.n + count(tree.first) + count(tree.second) + count(tree.third) + count(tree.fourth) : 0;
}
const tree = build(11);
const total = count(tree);
const grown = process.memoryUsage().rss - before;
console.log(total, tree !== null);
console.log("grew by less than 80 MB:", grown < 80 * 1024 * 1024);
Bun.gc(true);
const kept = process.memoryUsage().heapUsed - usedBefore;
console.log("what is kept takes less than 75 MB of the heap:", kept < 75 * 1024 * 1024);
console.log(count(tree));
