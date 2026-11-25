// A loop over an object with a generator method under Symbol.iterator: the method goes over objects of its own class.
// STATISTIC: GeneratorMethodsInlinedIntoIterations >= 1
class Tree { constructor(private value: number, private below: Tree[]) {} *[Symbol.iterator](): Generator<number> { yield this.value; for (const child of this.below) for (const value of child) yield value; } }
function total(tree: Tree): number { let sum = 0; for (const value of tree) sum += value; return sum; }
const tree = new Tree(1, [new Tree(2, [new Tree(3, [])]), new Tree(4, [])]);
for (let turn = 0; turn < 3; turn++) console.log(total(tree));
