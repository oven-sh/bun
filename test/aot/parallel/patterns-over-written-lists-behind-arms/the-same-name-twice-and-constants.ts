const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function take(at: number, tools: { round: (x: number) => number }): string {
  const r = tools.round(at + 0.5);
  const [a, b, c, d] = [r, r, 7, "t"];
  return a + ":" + b + ":" + c + ":" + d;
}
console.log(take(1, kit), take(2, kit));
