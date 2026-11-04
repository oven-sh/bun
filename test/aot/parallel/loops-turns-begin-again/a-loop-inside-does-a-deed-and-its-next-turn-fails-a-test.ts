// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Box = { value: number };
type Table = { scale: number };
let deeds = 0;
function run(table: Table, rows: Box[][]): number {
  let total = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let i = 0; i < row.length; i++) {
      total += row[i].value * table.scale;
      deeds++;
    }
  }
  return total;
}
function main() {
  const rows: Box[][] = [];
  for (let r = 0; r < 30; r++) {
    const row: Box[] = [];
    for (let i = 0; i < 10; i++) row.push({ value: r + i });
    rows.push(row);
  }
  rows[11][4] = { far: 0, value: 6 } as any;
  rows[20][0] = { far: 1, value: 7 } as any;
  const table: Table = { scale: 2 };
  (globalThis as any).held = [rows, table];
  (0, eval)("1");
  console.log(run(table, rows), deeds);
}
main();
