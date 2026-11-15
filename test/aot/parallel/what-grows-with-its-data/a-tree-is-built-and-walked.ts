// Recursion as deep as the logarithm of the size.
// Sizes: 250 1000 4000
// Passes: 3300
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
type Tree = { left: Tree | null; right: Tree | null; value: number };
function build(from: number, to: number): Tree | null {
  if (from >= to) return null;
  const mid = (from + to) >> 1;
  return { left: build(from, mid), right: build(mid + 1, to), value: mid & 15 };
}
function sum(tree: Tree | null): number {
  return tree ? sum(tree.left) + tree.value + sum(tree.right) : 0;
}
function once(): string {
  return [sum(build(0, size * 2))].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
