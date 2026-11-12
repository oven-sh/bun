function doubled(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
const texts: string[] = [doubled(JSON.parse('"ab"'), 1), doubled(JSON.parse('"ab"'), 29)];
const lists: string[][] = JSON.parse('[["x","abab-abab","y"],["z"]]');
function matches(line: string, name: string, tail: string, stop: boolean): boolean {
  if (stop) return false;
  return line === name + "-" + tail;
}
function find(among: string[], name: string, tail: string, stop: boolean): number {
  let found = 0;
  for (let k = 0; k < among.length; k++) {
    if (matches(among[k]!, name, tail, stop)) found = k + 1;
  }
  return found;
}
let all = "";
for (let i = 0; i < 4; i++) {
  try {
    all += find(lists[0]!, texts[i >> 1]!, texts[i >> 1]!, (i & 1) === 1) + ",";
  } catch (error) {
    all += (error as Error).constructor.name + ",";
  }
}
console.log(all);
