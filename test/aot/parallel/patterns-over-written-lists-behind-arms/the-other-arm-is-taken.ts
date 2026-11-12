const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor };
const own = { round: (x: number): number => x * 2 };
unseen(kit);
unseen(own);
function take(at: number, tools: { round: (x: number) => number }): string {
  let a = tools.round(at + 0.5),
    b = at + 1;
  [a, b] = [b, a];
  return a + ":" + b;
}
let last = "";
for (let i = 0; i < 300; i++) last = take(i, (i & 1) === 1 ? own : kit) + " " + take(i, (i & 1) === 1 ? kit : own);
console.log(last);
