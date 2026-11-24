const lines: string[] = JSON.parse('["v=1","v=a","v=2","v=b"]');
const values: (number | string)[] = JSON.parse('[2,"b",1,"a","zz",7]');
function find(among: string[], value: number | string): number {
  let found = 0;
  for (let k = 0; k < among.length; k++) {
    if (among[k] === "v=" + value) found = k + 1;
  }
  return found;
}
let all = "";
for (let i = 0; i < 12; i++) all += find(lines, values[i % 6]!) + ",";
console.log(all);
