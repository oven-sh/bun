const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor, size: Math.abs };
unseen(kit);
function take(at: number, tools: { round: (x: number) => number; size: (x: number) => number }): string {
  const [a, b] = [tools.round(at + 0.5), tools.size(-at)];
  return a + ":" + b;
}
console.log(take(1, kit), take(2, kit));
