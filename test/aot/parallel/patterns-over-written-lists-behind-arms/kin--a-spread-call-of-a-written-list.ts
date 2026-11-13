const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor, size: Math.abs, parse: parseInt };
unseen(kit);
type Tools = { round: (x: number) => number; size: (x: number) => number; parse: (t: string) => number };
function take(at: number, tools: Tools): string {
  return String(Math.max(...[tools.round(at + 0.5), at + 1]));
}
console.log(take(1, kit), take(2, kit));
