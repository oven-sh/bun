type Stock = Record<string, number>;
function weigh(n: number): number { let w = 0; for (let i = 0; i < n; i++) w = (w + i) | 0; return w; }
function tally(stock: Stock, n: number): string {
  const rows = Object.entries(stock);
  let total = weigh(n);
  for (const [name, count] of rows) total = (total + count + name.length) | 0;
  return "" + total;
}
console.log(tally({ apples: 3, pears: 4 }, 4), tally({ figs: 6 }, 2));
