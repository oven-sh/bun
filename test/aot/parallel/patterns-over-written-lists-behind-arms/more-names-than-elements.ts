const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function take(at: number, tools: { round: (x: number) => number }): string {
  const [a, b, c = 7] = [tools.round(at + 0.5), at + 1] as number[];
  return a + ":" + b + ":" + c;
}
console.log(take(1, kit), take(2, kit));
