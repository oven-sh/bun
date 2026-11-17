const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor, size: Math.abs, parse: parseInt };
unseen(kit);
type Tools = { round: (x: number) => number; size: (x: number) => number; parse: (t: string) => number };
function take(at: number, tools: Tools): string {
  let a = tools.round(at + 0.5), b = at + 1, c = at + 2;
  [a, b, c] = [b, c, a];
  return a + ":" + b + ":" + c;
}
console.log(take(1, kit), take(2, kit));
