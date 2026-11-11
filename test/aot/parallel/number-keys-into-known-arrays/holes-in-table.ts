// Under: --aot-testing=CheckBoundsAtRunTime: every read of an element is checked against its array
// Holes, doubles and, late, a string in the table.
const table: number[] = [0, 1, , 3, 4.5, , 6] as number[];
function sum(cells: readonly number[]): string {
  let total: number | string = 0;
  let missing = 0;
  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i]!;
    const value = table[Math.abs(cell)];
    if (value === undefined) missing++;
    else total = (total as number) + value;
  }
  return total + " " + missing;
}
const cells = [1, -3, 2, 4, -5, 6, 7, 0];
let lines = sum(cells) + "\n";
table[2] = 2;
lines += sum(cells) + "\n";
table[5] = 0.25;
lines += sum(cells) + "\n";
(table as unknown[])[3] = JSON.parse('"text"');
lines += sum(cells) + "\n";
table[3] = 3;
lines += sum(cells.map(cell => cell + 0.5)) + "\n";
lines += sum(cells) + "\n";
console.log(lines);
