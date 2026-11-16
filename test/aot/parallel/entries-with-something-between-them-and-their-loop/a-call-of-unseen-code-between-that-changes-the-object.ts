const unseen = (x: unknown): any => [x][JSON.parse("0")];
type Stock = Record<string, number>;
const spoil = unseen((stock: Stock) => { stock.late = 9; delete stock.apples; return 1; });
function tally(stock: Stock): string {
  const rows = Object.entries(stock);
  const spoiled = spoil(stock);
  let text = "";
  for (const [name, count] of rows) text += name + "=" + count + " ";
  return text + spoiled + " " + Object.keys(stock).join(",");
}
console.log(tally({ apples: 3, pears: 4 }));
