// An outer loop puts lines together and an inner loop the cells of a line, from a list of lists of texts. A turn of the inner loop cuts its row, and another one the list of rows.
function mix(sum: number, next: number): number {
  return (sum * 31 + next * 8) | 0;
}
function work(rows: string[][], at: number): string {
  let page = "";
  let turn = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]!;
    const n = row.length;
    let line = row[0] + ":";
    for (let c = 1; c < n; c++) {
      if (turn++ === at) r & 1 ? (rows.length = r + 1) : (row.length = c);
      line += row[c] + ";";
    }
    page += line + "|";
  }
  return page;
}
const made = (i: number) => [
  ["a" + i, "b", "c"],
  ["d", "e" + i, "f"],
  ["g", "h", "i" + i],
];
let total = 0;
for (let i = 0; i < 300; i++) total = mix(total, work(made(i), i % 8).length);
console.log(total, work(made(0), 1), work(made(0), 2), work(made(0), 9));
