class Node {
  constructor(key, weight, left, right) { this.key = key; this.weight = weight; this.left = left; this.right = right; }
}
function walk(node, key, exact) {
  const left = node.left, right = node.right;
  if (!left || !right) return node.key;
  if (!left.weight || !right.weight || !left.left || !right.left) return node.key;
  const goLeft = exact ? key === left.key : key < right.key;
  const side = goLeft ? left : right;
  const weight = goLeft ? left.weight : right.weight;
  if (weight && side.left) return walk(side.left, key, exact) + side.left.key;
  return -1;
}
const leaf = (k) => new Node(k, 1, null, null);
const mid = (k) => new Node(k, 2, leaf(k * 10), leaf(k * 10 + 1));
const root = new Node(0, 1, new Node(1, 2, mid(2), mid(3)), new Node(5, 3, mid(6), mid(7)));
const exact = process.argv[3] === "exact";
let s = 0;
for (let i = 0; i < 100000; i++) s += walk(root, i % 11, exact);
console.log(s);
