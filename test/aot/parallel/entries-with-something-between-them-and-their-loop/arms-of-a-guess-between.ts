const unseen = (x: unknown): any => [x][JSON.parse("0")];
type Stock = Record<string, number>;
const kit = { round: Math.floor };
const own = { round: (x: number): number => x * 2 };
unseen(kit);
unseen(own);
function tally(stock: Stock, tools: { round: (x: number) => number }, at: number): string {
  const rows = Object.entries(stock);
  let total = tools.round(at + 0.5);
  for (const [name, count] of rows) total = total + count + name.length;
  return "" + total;
}
console.log(tally({ apples: 3, pears: 4 }, kit, 1), tally({ figs: 6 }, own, 2));
