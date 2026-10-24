// A tree of 1.4 million nodes whose constructor constructs the children.
// Measured: 69 to 70 MB; 89 to 90 MB where the nodes counted as made seldom; 99 to 101 MB in plain Bun.
declare const console: { log(...values: unknown[]): void };
declare const process: { memoryUsage(): { rss: number } };
const before = process.memoryUsage().rss;
class Tree {
  first: Tree | null; second: Tree | null; third: Tree | null; fourth: Tree | null; n: number;
  constructor(depth: number) {
    this.n = depth;
    this.first = depth > 1 ? new Tree(depth - 1) : null;
    this.second = depth > 1 ? new Tree(depth - 1) : null;
    this.third = depth > 1 ? new Tree(depth - 1) : null;
    this.fourth = depth > 1 ? new Tree(depth - 1) : null;
  }
}
function count(tree: Tree | null): number {
  return tree ? tree.n + count(tree.first) + count(tree.second) + count(tree.third) + count(tree.fourth) : 0;
}
const tree = new Tree(11);
const total = count(tree);
const grown = process.memoryUsage().rss - before;
console.log(total, tree.n);
console.log("grew by less than 80 MB:", grown < 80 * 1024 * 1024);
