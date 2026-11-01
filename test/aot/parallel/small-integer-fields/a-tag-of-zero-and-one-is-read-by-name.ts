// Code that runs seldom reads a field by name from a value of unknown type. The table of fields answers for a field that holds 0 or 1 as it does for any integer of 32 bits, so the run time is not asked.
// Flags: --aot-heat=EverythingIsCold
// COUNT: operation:operationAOTGetByIdAndCache = 0
const key = process.env.SHELF || "shelf";
const few = process.argv.length;
const anything: any = few > 50 ? { shelf: 0 } : globalThis;
type Leaf = { kind: 0; value: number };
type Pair = { kind: 1; left: number; right: number };
type Tree = Leaf | Pair;
function worth(tree: Tree): number {
  return tree.kind === 0 ? tree.value : tree.left + tree.right;
}
function put(x: Tree) {
  anything[key] = x;
}
function take(depth: number): any {
  return depth ? take(depth - 1) : anything[key];
}
const first: Tree = few > 50 ? { kind: 0, value: few } : { kind: 1, left: few, right: 1 };
const second: Tree = few > 50 ? { kind: 1, left: few, right: 1 } : { kind: 0, value: few };
let sum = worth(first) + worth(second);
put(first);
for (let i = 0; i < 500; i++) sum += take(0).kind;
put(second);
for (let i = 0; i < 500; i++) sum += take(0).kind;
console.log(sum);
