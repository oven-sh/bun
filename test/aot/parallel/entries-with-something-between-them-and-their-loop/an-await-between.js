async function tally(stock, later) {
  const rows = Object.entries(stock);
  let total = await later;
  for (const [name, count] of rows) total = total + count + name.length;
  return total;
}
console.log((await Promise.all([tally({ apples: 3, pears: 4 }, Promise.resolve(1)), tally({ figs: 6 }, new Promise((done) => setTimeout(() => done(2), 5)))])).join(" "));
