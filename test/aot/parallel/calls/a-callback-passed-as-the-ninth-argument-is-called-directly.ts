// A callback passed behind the eighth argument is called directly, like one passed in front of it. Whole-program analysis keeps a node for each argument position up to the
// most positional parameters among the callees, not for the first eight alone: the ninth parameter receives the ninth argument alone, the tenth the tenth, and neither may be undefined.
// STATISTIC: IndirectCalls = 0
// Todo: the engine that webkit.ts pins keeps nodes for the first eight positions alone, so the ninth and the tenth parameter may be undefined and both calls are indirect: IndirectCalls = 2. The engine of oven-sh/WebKit#991 keeps ten
class Tree {
  constructor(
    readonly offsets: Int32Array,
    readonly labels: string,
  ) {}
  first(node: number): number {
    return this.labels.charCodeAt(this.offsets[node]);
  }
}

type Visit = (code: number, tree: Tree) => void;
type Done = (count: number) => void;

function walk(
  tree: Tree,
  node: number,
  p1: number,
  p2: number,
  p3: number,
  p4: number,
  p5: number,
  p6: number,
  visit: Visit,
  done: Done,
): void {
  if (node >= tree.offsets.length) {
    done(node + p1 + p2 + p3 + p4 + p5 + p6);
    return;
  }
  visit(tree.first(node), tree);
  walk(tree, node + 1, p1, p2, p3, p4, p5, p6, visit, done);
}

const tree = new Tree(new Int32Array([0, 1, 2, 3]), "abcd");
let sum = 0;
let visited = 0;
walk(
  tree,
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  (code, seen) => {
    sum += code + seen.offsets.length;
  },
  count => {
    visited = count;
  },
);
console.log(sum, visited);
