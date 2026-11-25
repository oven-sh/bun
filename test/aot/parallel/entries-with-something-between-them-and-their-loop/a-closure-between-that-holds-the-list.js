function tally(stock) {
  const rows = Object.entries(stock);
  const size = () => rows.length;
  let total = 0;
  for (const [name, count] of rows) total = total + count + name.length;
  return total + ":" + size() + ":" + JSON.stringify(rows[0]);
}
console.log(tally({ apples: 3, pears: 4 }), tally({ figs: 6 }));
