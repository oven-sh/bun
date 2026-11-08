const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor, size: Math.abs, parse: parseInt };
unseen(kit);
type Tools = { round: (x: number) => number; size: (x: number) => number; parse: (t: string) => number };
function take(at: number, tools: Tools): string {
  let a = tools.size(at - 5), b = at + 1;
  [a, b] = [b, a];
  return a + ":" + b;
}
console.log(take(1, kit), take(2, kit));
