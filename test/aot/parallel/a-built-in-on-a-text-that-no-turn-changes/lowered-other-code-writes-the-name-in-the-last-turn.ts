function doubled(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
const texts: string[] = [doubled(JSON.parse('"ab"'), 1), doubled(JSON.parse('"ab"'), 12)];
const among: string[] = JSON.parse('["x","abab-abab","y"]');
const small = texts[0]!, big = texts[1]!;
let prefix = small;
const hooks: (() => void)[] = [() => { prefix = big; }, () => { }];
function last(turns: number, tail: string, at: number, hook: () => void): number {
  let out = "";
  for (let k = 0; k < turns; k++) {
    out = prefix.toLowerCase();
    if (k === at) hook();
  }
  return out.length;
}
function reset(): number { prefix = small; return Number("3"); }
let all = "";
for (let i = 0; i < 4; i++) {
  try {
    all += last(reset(), texts[i & 1]!, 2, hooks[i >> 1]!) + ",";
  } catch (error) {
    all += (error as Error).constructor.name + ",";
  }
}
console.log(all);
