let sum = 0;
const kept = [];
for (let round = 0; round < 40; round++) {
  let list = null;
  for (let i = 0; i < 60000; i++) list = { value: i, next: i % 50 ? list : null, text: "t" + (i & 7), pair: [i, round] };
  kept[round % 8] = list;
  const tree = depth => (depth ? { left: tree(depth - 1), right: tree(depth - 1) } : { leaf: round });
  const count = node => (node.leaf === undefined ? count(node.left) + count(node.right) : 1);
  sum += count(tree(12));
  const closures = Array.from({ length: 20000 }, (_, i) => () => i + round);
  sum += closures[round]() + new Array(5000).fill(round).length + new ArrayBuffer(1 << 16).byteLength;
  const weak = new WeakRef(closures), registry = new WeakMap(closures.map(f => [f, round]));
  sum += weak.deref().length + registry.get(closures[1]);
}
Bun.gc(true);
for (const list of kept) for (let node = list; node; node = node.next) sum += node.value;
console.log(sum);
