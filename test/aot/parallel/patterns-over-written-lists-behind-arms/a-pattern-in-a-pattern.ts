const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function take(at: number, tools: { round: (x: number) => number }): string {
  const [[a, b], c] = [[at + 1, tools.round(at + 0.5)], tools.round(at + 2.5)];
  return a + ":" + b + ":" + c;
}
console.log(take(1, kit), take(2, kit));
