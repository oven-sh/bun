function totals(rows) {
  const out = {};
  for (const row of rows) {
    const held = out[row.kind] ?? (out[row.kind] = { count: 0, sum: 0 });
    held.count++;
    held.sum += row.worth;
  }
  return out;
}
const all = totals(JSON.parse('[{"kind":"a","worth":2},{"kind":"b","worth":5},{"kind":"a","worth":4}]'));
console.log(all.a.count, all.a.sum, JSON.stringify(all));
