// COUNT: operation:operationAOTJSONParseExtraMembers <= 300
// COUNT: operation:operationAOTJSONObjectFinish <= 60
// COUNT: counter:TypedParsesFellBackPerValue = 0
interface Tree { name: string; size: number; children: Tree[] }
function text(depth: number, n: number): string {
  let children = "";
  if (depth) for (let i = 0; i < 3; i++) children += (i ? "," : "") + text(depth - 1, n * 3 + i);
  return `{"name":"node ${n}","kind":"dir","size":${n},"mode":420,"children":[${children}],"owner":"root"}`;
}
const count = (tree: Tree): number => { let sum = tree.size; for (const child of tree.children) sum += count(child); return sum; };
let sum = 0;
for (let i = 0; i < 200; i++) sum += count(JSON.parse(text(3, i & 3)) as Tree);
console.log(sum);
