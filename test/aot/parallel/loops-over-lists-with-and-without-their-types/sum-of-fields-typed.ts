const n = +process.argv[2] || 3000;
interface Node { kind: number; next: Node | null }
const list: Node[] = [];
for (let i = 0; i < 1000; i++) list.push({ kind: i & 7, next: null });
function run(list: Node[]): number {
  let s = 0;
  for (let i = 0; i < list.length; i++) s += list[i].kind;
  return s;
}
let all = 0;
for (let k = 0; k < n / 1000; k++) all += run(list);
console.log(all);
