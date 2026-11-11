function doubled(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
const texts: string[] = [doubled(JSON.parse('"ab"'), 1), doubled(JSON.parse('"ab"'), 12)];
const lists: string[][] = JSON.parse('[["x","abab-abab","y"],["z"]]');
function check(stop: boolean): number {
  if (stop) throw new TypeError("stop");
  return 1;
}
function find(among: string[], name: string, tail: string, stop: boolean): number {
  let found = 0;
  for (let k = 0; k < among.length; k++) {
    const one = check(stop);
    if (among[k] === name.toLowerCase()) found = k + one;
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
