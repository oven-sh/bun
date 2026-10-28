// A union whose tags are the numbers 0 and 1, and one of three members from 0 on.
type Leaf = { op: 0; value: number };
type Pair = { op: 1; left: number; right: number };
type Triple = { op: 2; a: number; b: number; c: number };

function two(tree: Leaf | Pair): number {
  if (tree.op !== 0) return tree.left + tree.right;
  return tree.value;
}

function three(tree: Leaf | Pair | Triple): number {
  switch (tree.op) {
    case 0:
      return tree.value;
    case 1:
      return tree.left * tree.right;
    case 2:
      return tree.a + tree.b + tree.c;
  }
}

const trees: (Leaf | Pair | Triple)[] = [];
for (let index = 0; index < 30; index++) {
  if (index % 3 === 0) trees.push({ op: 0, value: index + 0.5 });
  else if (index % 3 === 1) trees.push({ op: 1, left: index, right: 0.25 });
  else trees.push({ op: 2, a: index, b: 1, c: -0.5 });
}
let sum = 0;
for (const tree of trees) {
  sum += three(tree);
  if (tree.op !== 2) sum += two(tree);
}
console.log(sum, trees.map(tree => tree.op).join(""), JSON.stringify(trees[0]), JSON.stringify(trees[1]), Object.keys(trees[2]).join());
