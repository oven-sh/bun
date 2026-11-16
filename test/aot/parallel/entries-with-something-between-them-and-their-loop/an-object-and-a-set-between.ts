type Stock = Record<string, number>;
function tally(stock: Stock): string {
  const rows = Object.entries(stock);
  const held = { total: 0 };
  const seen = new Set<string>();
  for (const [name, count] of rows) {
    held.total = (held.total + count) | 0;
    seen.add(name);
  }
  return held.total + ":" + seen.size;
}
console.log(tally({ apples: 3, pears: 4 }), tally({ figs: 6 }));
