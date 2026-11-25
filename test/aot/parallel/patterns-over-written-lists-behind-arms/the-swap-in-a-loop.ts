const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function take(turns: number, tools: { round: (x: number) => number }): string {
  let a = 0,
    b = 1,
    sum = 0;
  for (let i = 0; i < turns; i++) {
    [a, b] = [b, tools.round(a + b + 0.5)];
    sum = (sum + a) | 0;
  }
  return a + ":" + b + ":" + sum;
}
console.log(take(10, kit), take(20, kit));
