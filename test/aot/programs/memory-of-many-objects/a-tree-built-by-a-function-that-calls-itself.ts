// A tree of 1.4 million nodes, built by a function that calls itself: no loop stands around the allocation, and it is made often all the same.
// Measured: 70 MB; 92 MB where the nodes counted as made seldom; 99 MB in plain Bun.
declare const console: { log(...values: unknown[]): void };
declare const process: { memoryUsage(): { rss: number } };
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
