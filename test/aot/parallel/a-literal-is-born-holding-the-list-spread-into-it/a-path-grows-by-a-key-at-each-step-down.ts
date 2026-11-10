// `[...path, key]` handed down at each step of a walk: the list is born holding the path, with room for the key.
// STATISTIC: ArrayLiteralsAllocatedFromSpread >= 1
// COUNT: operation:operationAOTAppendElements <= 2
// COUNT: operation:operationAOTArrayPush <= 40
interface Knot { name: string; kids: Knot[] }
function tree(depth: number, name: string): Knot { return { name, kids: depth ? [0, 1, 2].map(i => tree(depth - 1, name + i)) : [] }; }
const seen: string[] = [];
function visit(node: Knot, path: string[]): number {
  let count = path.length;
  if (!node.kids.length && seen.length < 12) seen.push(path.join("/"));
  const kids = node.kids;
  for (let i = 0; i < kids.length; i++) count += visit(kids[i], [...path, kids[i].name]);
  return count;
}
(globalThis as any).kept = visit;
const root = tree(5, "r");
let sum = 0;
for (let t = 0; t < 40; t++) sum += visit(root, []);
console.log(sum, seen.join(" "));
export {};
