const n = +process.argv[2] || 3000;
const list: number[] = [];
for (let i = 0; i < 1000; i++) list.push(i & 7);
function run(list: number[]): number {
  for (let i = 0; i < list.length; i++) list[i] = i & 3;
  return list.length;
}
let all = 0;
for (let k = 0; k < n / 1000; k++) all += run(list);
console.log(all);
