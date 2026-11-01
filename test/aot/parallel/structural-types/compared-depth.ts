// A tree flows into a wider type, and a text is stored through the wider type three levels down: by a field, an element, a result and a push. Nothing below the two types is compared.
// Flags: --aot-limit=MaxComparedTypeDepth:0
interface Leaf {
  n: number;
}
interface WideLeaf {
  n: number | string;
}
interface Twig {
  leaf: Leaf;
  leaves: Leaf[];
  grow(): Leaf;
}
interface WideTwig {
  leaf: WideLeaf;
  leaves: WideLeaf[];
  grow(): WideLeaf;
}
interface Branch {
  twig: Twig;
  twigs: Twig[];
  fork(): Twig;
}
interface WideBranch {
  twig: WideTwig;
  twigs: WideTwig[];
  fork(): WideTwig;
}
interface Tree {
  branch: Branch;
  branches: Branch[];
  split(): Branch;
}
interface WideTree {
  branch: WideBranch;
  branches: WideBranch[];
  split(): WideBranch;
}

function makeLeaf(n: number): Leaf {
  return { n };
}
function makeTwig(n: number): Twig {
  const leaf = makeLeaf(n);
  return {
    leaf,
    leaves: [leaf, makeLeaf(n + 1)],
    grow() {
      return leaf;
    },
  };
}
function makeBranch(n: number): Branch {
  const twig = makeTwig(n);
  return {
    twig,
    twigs: [twig, makeTwig(n + 2)],
    fork() {
      return twig;
    },
  };
}
function makeTree(n: number): Tree {
  const branch = makeBranch(n);
  return {
    branch,
    branches: [branch, makeBranch(n + 4)],
    split() {
      return branch;
    },
  };
}

function widen(tree: Tree): WideTree {
  return tree;
}
function spoil(wide: WideTree, turn: number): void {
  if (turn % 4 === 0) wide.branch.twig.leaf.n = "field";
  if (turn % 4 === 1) wide.branches[1].twigs[1].leaves[1].n = "element";
  if (turn % 4 === 2) wide.split().fork().grow().n = "result";
  if (turn % 4 === 3) wide.branch.twigs[0].leaves.push({ n: "pushed" });
}
function total(tree: Tree): number {
  let sum = tree.branch.twig.leaf.n + tree.split().fork().grow().n;
  for (const branch of tree.branches)
    for (const twig of branch.twigs) for (const leaf of twig.leaves) sum = sum + leaf.n;
  return sum;
}
let told = "";
for (let turn = 0; turn < 8; turn++) {
  const tree = makeTree(turn);
  told += typeof total(tree) + ":" + total(tree) + " ";
  spoil(widen(tree), turn);
  told += typeof total(tree) + ":" + total(tree) + "\n";
}
console.log(told);
