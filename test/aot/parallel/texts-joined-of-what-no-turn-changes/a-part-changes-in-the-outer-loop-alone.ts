function count(rows: string[], columns: number, wanted: string): number {
  let hits = 0;
  for (let row = 0; row < rows.length; row++) {
    const name = rows[row]!;
    for (let column = 0; column < columns; column++) {
      if (name + ":" + rows.length === wanted) hits += column + 1;
    }
  }
  return hits;
}
const rows: string[] = JSON.parse('["a","b","c"]');
console.log(count(rows, Number("4"), JSON.parse('"b:3"')), count(rows, Number("0"), JSON.parse('"b:3"')), count([], Number("4"), JSON.parse('"b:3"')));
