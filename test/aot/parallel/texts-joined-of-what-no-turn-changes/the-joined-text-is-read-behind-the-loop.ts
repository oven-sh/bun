function doubled(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
const texts: string[] = [doubled(JSON.parse('"ab"'), 1), doubled(JSON.parse('"ab"'), 29)];
const lists: string[][] = JSON.parse('[["x","abab-abab","y"],["z"]]');
lists[1]!.pop();
function last(among: string[], name: string, tail: string): string {
  let joined = "none";
  for (let k = 0; k < among.length; k++) {
    joined = name + "-" + tail;
    if (among[k] === joined) break;
  }
  return joined;
}
let all = "";
for (let i = 0; i < 4; i++) {
  try {
    all += last(lists[i & 1]!, texts[i >> 1]!, texts[i >> 1]!) + ",";
  } catch (error) {
    all += (error as Error).constructor.name + ",";
  }
}
console.log(all);
