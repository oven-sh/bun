// Two functions that each hold inlined calls stand on one stack in turn. Every trace lists the same frames, the first and the ones taken after it, at every limit.
class Refused extends Error {
  constructor(message: string) {
    super(message);
    Error.captureStackTrace(this, Refused);
  }
}
function descend(levels: number): Error {
  if (levels === 0) return new Refused("near");
  return descend(levels - 1);
}
function throughFirst(levels: number, error: Error): number {
  return second(levels - 1, error) + 1;
}
function throughSecond(levels: number, error: Error): number {
  return first(levels - 1, error) + 1;
}
function first(levels: number, error: Error): number {
  if (levels <= 0) {
    Error.captureStackTrace(error);
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < levels; i++) sum += i;
  return throughFirst(levels, error) + (sum & 1);
}
function second(levels: number, error: Error): number {
  if (levels <= 0) {
    Error.captureStackTrace(error);
    return 0;
  }
  let sum = 0;
  for (let i = 0; i < levels; i++) sum ^= i;
  return throughSecond(levels, error) + (sum & 1);
}
class Branch {
  constructor(public below: Branch | Leaf) {}
  accept(visitor: Visitor): number {
    return visitor.enter(this) + 1;
  }
}
class Leaf {
  accept(visitor: Visitor): number {
    Error.captureStackTrace(visitor.error);
    return 0;
  }
}
class Visitor {
  error = new Error("tree");
  enter(branch: Branch): number {
    return this.descend(branch.below) + 1;
  }
  descend(node: Branch | Leaf): number {
    return node.accept(this) + 1;
  }
}
let tree: Branch | Leaf = new Leaf();
for (let i = 0; i < 6; i++) tree = new Branch(tree);
const shown = (error: Error) => String(error.stack).replaceAll(import.meta.dir, "");
for (const limit of [10, 3, 40]) {
  Error.stackTraceLimit = limit;
  for (let turn = 0; turn < 3; turn++) {
    console.log("limit", limit, "turn", turn);
    console.log(shown(descend(10)));
    const error = new Error("two");
    first(7 + turn, error);
    console.log(shown(error));
    const visitor = new Visitor();
    tree.accept(visitor);
    console.log(shown(visitor.error));
    console.log(shown(new Error("plain")));
  }
}
