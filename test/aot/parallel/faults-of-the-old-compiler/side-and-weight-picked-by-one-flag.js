class Node {
  constructor(key, weight, child) { this.key = key; this.weight = weight; this.child = child; }
}
function descend(tree, key, exact) {
  const left = tree.left, right = tree.right;
  if (!left.weight || !right.weight || !left.child || !right.child) return "none";
  const goLeft = exact ? key === left.key : key < right.key;
  const side = goLeft ? left : right;
  const weight = goLeft ? left.weight : right.weight;
  if (weight && side.child) return side.child.key;
  return "leaf";
}
const tree = { left: new Node(1, 2, new Node(10, 1, null)), right: new Node(5, 3, new Node(50, 1, null)) };
console.log(descend(tree, 9, false));
console.log(descend(tree, 5, true));
