function doubled(seed: string, times: number): string { let text = seed; for (let k = 0; k < times; k++) text = text + text; return text; }
const texts: string[] = [doubled(JSON.parse('"ab"'), 1), doubled(JSON.parse('"ab"'), 12)];
const lists: string[][] = JSON.parse('[["x","abab-abab","y"],[null,"y"]]');
function find(among: string[], name: string, tail: string): number { let found = 0; for (let k = 0; k < among.length; k++) { found += among[k]!.length; if (among[k] === name.toLowerCase()) found += 100; } return found; }
let all = "";
for (let i = 0; i < 4; i++) {
  try { all += find(lists[i & 1]!, texts[i >> 1]!, texts[i >> 1]!) + ","; } catch (error) { all += (error as Error).constructor.name + ","; }
}
console.log(all);
