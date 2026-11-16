const lines: string[] = JSON.parse('["alpha=1","beta=2","gamma=3","delta=4","epsilon=5","zeta=6","eta=7","theta=8"]');
const names: string[] = JSON.parse('["eta","iota","theta","kappa"]');
function find(among: string[], name: string, value: number): number {
  let found = 0;
  for (let k = 0; k < among.length; k++) {
    if (among[k] === name + "=" + value) found = k + 1;
  }
  return found;
}
let all = "";
for (let i = 0; i < 16; i++) all += find(lines, names[i & 3]!, 7 + ((i >> 1) & 1)) + ",";
console.log(all, find([], names[0]!, Number("7")));
