const unseen = (x: unknown): any => [x][JSON.parse("0")];
const kit = { round: Math.floor };
unseen(kit);
function run(turns: number, tools: { round: (x: number) => number }): number {
  let a = 0,
    b = 1;
  for (let i = 0; i < turns; i++) [a, b] = [b, tools.round((a + b) % 1000003)];
  return a;
}
console.log(run(200000, kit));
