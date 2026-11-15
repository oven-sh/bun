function doubled(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
const texts: string[] = [doubled(JSON.parse('"a"'), 2), doubled(JSON.parse('"a"'), 29), doubled(JSON.parse('"a"'), 30)];
const among: string[] = JSON.parse('["x","aaaa-aaaa","y"]');
function find(lines: string[], name: string, tail: string): number {
  let found = 0;
  for (let k = 0; k < lines.length; k++) {
    if (lines[k]!.length === (name + "-" + tail).length) found = k + 1;
  }
  return found;
}
let all = "";
for (let i = 0; i < 9; i++) {
  try {
    all += find(among, texts[i % 3]!, texts[(i / 3) | 0]!) + ",";
  } catch (error) {
    all += (error as Error).constructor.name + ",";
  }
}
console.log(all);
