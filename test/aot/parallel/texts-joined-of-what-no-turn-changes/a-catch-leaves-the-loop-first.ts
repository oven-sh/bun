function doubled(seed: string, times: number): string {
  let text = seed;
  for (let k = 0; k < times; k++) text = text + text;
  return text;
}
const texts: string[] = [doubled(JSON.parse('"ab"'), 1), doubled(JSON.parse('"ab"'), 29)];

class Cell { name: string; constructor(name: string) { this.name = name; } }
const lists: (Cell | null)[][] = [[new Cell("x"), new Cell("abab-abab")], [null, new Cell("y")]];
function find(among: (Cell | null)[], name: string, tail: string): number {
  let found = 0;
  for (let k = 0; k < among.length; k++) {
    let line = "";
    try { line = among[k]!.name; } catch { break; }
    if (line === name + "-" + tail) found = k + 1;
  }
  return found;
}
let all = "";
for (let i = 0; i < 4; i++) {
  try { all += find(lists[i & 1]!, texts[i >> 1]!, texts[i >> 1]!) + ","; } catch (error) { all += (error as Error).constructor.name + ","; }
}
console.log(all);
