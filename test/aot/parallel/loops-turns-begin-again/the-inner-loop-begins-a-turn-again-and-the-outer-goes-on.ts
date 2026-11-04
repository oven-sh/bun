// One deed. A loop is built twice; in its typed copy a test that fails while nothing of the turn was done begins the turn again in the other copy, and a test that answers the same in every turn is asked once in front.
type Box = { value: number };
function run(rows: Box[][]): number {
  let total = 0;
  let turns = 0;
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    for (let i = 0; i < row.length; i++) {
      total += row[i].value;
      turns++;
    }
    total = total % 100003;
  }
  return total * 1000 + (turns % 1000);
}
function main() {
  const rows: Box[][] = [];
  for (let r = 0; r < 40; r++) {
    const row: Box[] = [];
    for (let i = 0; i < 25; i++) row.push({ value: r * i });
    if (r % 7 === 3) row[r % 25] = { tag: "odd", value: 5 } as any;
    rows.push(row);
  }
  (globalThis as any).rows = rows;
  (0, eval)("1");
  console.log(run(rows));
}
main();
