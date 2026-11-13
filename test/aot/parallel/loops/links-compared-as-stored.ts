class Node {
  key: number;
  left: Node | null = null;
  right: Node | null = null;
  parent: Node | null = null;
  constructor(key: number) {
    this.key = key;
  }
}
class Tree {
  root: Node | null = null;
  add(key: number): Node {
    let parent: Node | null = null;
    let node = this.root;
    while (node) {
      parent = node;
      node = key < node.key ? node.left : node.right;
    }
    const added = new Node(key);
    added.parent = parent;
    if (!parent) this.root = added;
    else if (key < parent.key) parent.left = added;
    else parent.right = added;
    return added;
  }
  next(node: Node): Node | null {
    if (node.right) {
      let least: Node = node.right;
      while (least.left) least = least.left;
      return least;
    }
    let child = node;
    let above = node.parent;
    while (above && child === above.right) {
      child = above;
      above = above.parent;
    }
    return above;
  }
  depth(key: number): number {
    let depth = 0;
    for (let node = this.root; node !== null; node = key < node.key ? node.left : node.right) {
      if (node.key === key) return depth;
      if (node.left == node.right) depth += 100;
      if (node.left != node.parent) depth++;
    }
    return -1;
  }
}
function run(k: number): string {
  const tree = new Tree();
  let sum = 0;
  for (let i = 0; i < 500; i++) tree.add((i * 7919) % 1009);
  for (let i = 0; i < k; i++) sum = (sum + tree.depth(i % 1009)) | 0;
  let walked = 0;
  let node: Node | null = tree.root;
  while (node && node.left) node = node.left;
  for (; node; node = tree.next(node)) walked = (walked * 3 + node.key) | 0;
  const ring = new Node(1);
  ring.right = ring;
  let turns = 0;
  for (let at: Node | null = ring; at; at = at.right) {
    if (++turns > 5) at.right = null;
    if (at === at.right) sum++;
  }
  return sum + " " + walked + " " + turns;
}
console.log(run(5000), run(17));
