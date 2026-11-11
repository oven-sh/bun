interface Leaf {
  value: number;
  left?: Leaf;
  right?: Leaf;
}
function put(tree: Leaf | undefined, value: number): Leaf {
  if (!tree) return { value };
  if (value < tree.value) tree.left = put(tree.left, value);
  else tree.right = put(tree.right, value);
  return tree;
}
function inOrder(tree: Leaf | undefined, out: number[]): number[] {
  if (!tree) return out;
  inOrder(tree.left, out);
  out.push(tree.value);
  return inOrder(tree.right, out);
}
function run() {
  let tree: Leaf | undefined;
  for (const value of [5, 2, 8, 1]) tree = put(tree, value);
  const root = tree!;
  console.log(inOrder(root, []).join(), root.value, Object.keys(root).join());
}
run();
