const n = +process.argv[2] || 3000;
const list: (number | string)[] = [];
for (let i = 0; i < 1000; i++) list.push(i & 1 ? i & 7 : "x");
function run(list: (number | string)[]): number {
  let s = 0;
  for (let i = 0; i < list.length; i++) { const x = list[i]; if (typeof x === "number") s += x; }
  return s;
}
let all = 0;
for (let k = 0; k < n / 1000; k++) all += run(list);
console.log(all);
