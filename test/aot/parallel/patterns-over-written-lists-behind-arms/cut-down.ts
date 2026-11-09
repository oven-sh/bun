const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function take(at: number, tools: { round: (x: number) => number }): string {
  let a = tools.round(at + 0.5),
    b = tools.round(at + 0.5) + 1;
  [a, b] = [b, a];
  return a + ":" + b;
}
console.log(take(1, kit), take(2, kit));
