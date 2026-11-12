function doubled(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
const texts: string[] = [doubled(JSON.parse('"ab"'), 1), doubled(JSON.parse('"ab"'), 12)];
interface Row { name: string; }
const lists: Row[][] = JSON.parse('[[{"name":"x"},{"name":"abab-abab"}],[null]]');
function find(among: Row[], name: string, tail: string): number {
  let found = 0;
  for (let k = 0; k < among.length; k++) {
    if (among[k]!.name === name.toLowerCase()) found = k + 1;
  }
  return found;
}
let all = "";
for (let i = 0; i < 4; i++) {
  try {
    all += find(lists[i & 1]!, texts[i >> 1]!, texts[i >> 1]!) + ",";
  } catch (error) {
    all += (error as Error).constructor.name + ",";
  }
}
console.log(all);
