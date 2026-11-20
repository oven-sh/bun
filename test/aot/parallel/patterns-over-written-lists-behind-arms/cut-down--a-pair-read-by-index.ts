const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function take(at: number, tools: { round: (x: number) => number }): string {
  const both = [tools.round(at + 0.5) + 1, tools.round(at + 0.5)];
  return both[0] + ":" + both[1];
}
console.log(take(1, kit), take(2, kit));
