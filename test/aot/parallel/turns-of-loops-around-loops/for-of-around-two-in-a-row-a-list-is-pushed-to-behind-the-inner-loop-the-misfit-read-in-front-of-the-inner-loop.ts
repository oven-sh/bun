// a for-of loop around: two-in-a-row; a list is pushed to behind the inner loop; the object that fails the guess is read in front of the inner loop
type Box = { value: number };
const unseen = (0, eval)("(x) => x");
let deeds = 0;
function run(rows: Box[][], extras: Box[], state: { count: number }, log: number[], tables: { scale: number }[]): number { const table = tables[0]; let total = 0; let r = 0; for (const row of rows) { total += table.scale; const extra = extras[r];  total += extra.value; let sum = 0; for (let i = 0; i < row.length; i++) { sum += row[i].value;  } for (let j = 0; j < row.length; j++) sum += row[j].value; log.push(r); total += (sum | 0) + 1; r++; } return total; }
const rows: Box[][] = []; const extras: Box[] = []; const state = { count: 0 }; const log: number[] = [];
for (let r = 0; r < 12; r++) { const row: Box[] = []; for (let i = 0; i < 6; i++) row.push({ value: 1 }); rows.push(row); extras.push({ value: 1 }); }
extras[7] = JSON.parse('{"value":1}');
for (let k = 0; k < 3; k++) console.log(run(unseen(rows), unseen(extras), unseen(state), unseen(log), unseen([{ scale: 2 }])), deeds, state.count, log.length, log.join(""));
