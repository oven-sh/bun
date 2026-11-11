// Optional chains and defaults.
// Sizes: 250 1000 4000
// Passes: 3100
// Grows: linear
const size = Number(process.env.SIZE ?? 500),
  passes = Number(process.env.PASSES ?? 1);
type Node = { inner?: { leaf?: { value?: number } | null } };
function read(node: Node): number {
  return node.inner?.leaf?.value ?? -1;
}
function once(): string {
  const nodes: Node[] = [];
  for (let i = 0; i < size * 2; i++)
    nodes.push(i % 3 === 0 ? {} : i % 3 === 1 ? { inner: { leaf: null } } : { inner: { leaf: { value: i & 7 } } });
  let sum = 0;
  for (const node of nodes) sum += read(node);
  return [sum].join(" ");
}
let told = "";
for (let pass = 0; pass < passes; pass++) told = once();
console.log(told);
