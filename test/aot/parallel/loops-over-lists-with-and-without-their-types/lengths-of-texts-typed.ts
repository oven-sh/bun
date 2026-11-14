const n = +process.argv[2] || 3000;
const list: string[] = [];
for (let i = 0; i < 1000; i++) list.push("abcdefgh".slice(0, i & 7));
function run(list: string[]): number {
  let s = 0;
  for (let i = 0; i < list.length; i++) s += list[i].length;
  return s;
}
let all = 0;
for (let k = 0; k < n / 1000; k++) all += run(list);
console.log(all);
