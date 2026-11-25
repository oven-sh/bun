const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function take(at: number, tools: { round: (x: number) => number }): string {
  const held = { low: at + 1, high: at + 2 };
  [held.low, held.high] = [tools.round(held.high + 0.5), held.low];
  return held.low + ":" + held.high;
}
console.log(take(1, kit), take(2, kit));
