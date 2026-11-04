// One shape. A typed loop stands inside a typed loop. What the turn of the loop around has done, in front of the loop inside or in it, is done once, though a test behind the loop inside fails.
type Box = { value: number };
type Table = { scale: number };
const unseen = (0, eval)("(x) => x");
let deeds = 0;
function run(rows: Box[][], extras: Box[], tables: Table[]): number {
  const table = tables[0];
  let total = 0;
  for (let r = 0; r < rows.length; r++) {
    deeds++;
    total += table.scale;
    const row = rows[r];
    let sum = 0;
    let i = 0;
    for (; i < row.length; i++) {
      let j = 0;
      for (; j < 3; j++) sum += row[i].value;
      sum += j & 1;
    }
    total += (sum | 0) + (i & 7) + extras[r].value;
  }
  return total;
}
const rows: Box[][] = [];
const extras: Box[] = [];
const tables: Table[] = [{ scale: 2 }];
for (let r = 0; r < 40; r++) {
  const row: Box[] = [];
  for (let i = 0; i < 10; i++) row.push({ value: 1 });
  rows.push(row);
  extras.push({ value: 1 });
}
extras[25] = JSON.parse('{"value":1}');
for (let k = 0; k < 3; k++) console.log(run(unseen(rows), unseen(extras), unseen(tables)), deeds);
