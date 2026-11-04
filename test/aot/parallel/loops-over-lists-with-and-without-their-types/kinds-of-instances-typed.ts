const n = +process.argv[2] || 3000;
class Node { kind: number; constructor(kind: number) { this.kind = kind; } }
const list: Node[] = [];
for (let i = 0; i < 1000; i++) list.push(new Node(i & 7));
function run(list: Node[]): number {
  let s = 0;
  for (let i = 0; i < list.length; i++) if (list[i].kind === 3) s++;
  return s;
}
let all = 0;
for (let k = 0; k < n / 1000; k++) all += run(list);
console.log(all);
