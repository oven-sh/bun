const n = +process.argv[2] || 3000;
const list = [];
for (let i = 0; i < 1000; i++) list.push((i & 3) === 1);
function run(list) {
  let s = 0;
  for (let i = 0; i < list.length; i++) if (list[i]) s++;
  return s;
}
let all = 0;
for (let k = 0; k < n / 1000; k++) all += run(list);
console.log(all);
