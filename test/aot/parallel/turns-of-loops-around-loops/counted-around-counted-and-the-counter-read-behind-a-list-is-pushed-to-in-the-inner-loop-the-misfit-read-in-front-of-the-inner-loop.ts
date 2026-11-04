// a counted loop around: counted-and-the-counter-read-behind; a list is pushed to in the inner loop; the object that fails the guess is read in front of the inner loop
type Box = { value: number };
const unseen = (0, eval)("(x) => x");
let deeds = 0;
function run(rows: Box[][], extras: Box[], state: { count: number }, log: number[], tables: { scale: number }[]): number { const table = tables[0]; let total = 0; for (let r = 0; r < rows.length; r++) { const row = rows[r]; total += table.scale; const extra = extras[r];  total += extra.value; let sum = 0; let i = 0; for (; i < row.length; i++) { sum += row[i].value; log.push(r); } total += i & 7;  total += (sum | 0) + 1; } return total; }
const rows: Box[][] = []; const extras: Box[] = []; const state = { count: 0 }; const log: number[] = [];
for (let r = 0; r < 12; r++) { const row: Box[] = []; for (let i = 0; i < 6; i++) row.push({ value: 1 }); rows.push(row); extras.push({ value: 1 }); }
extras[7] = JSON.parse('{"value":1}');
for (let k = 0; k < 3; k++) console.log(run(unseen(rows), unseen(extras), unseen(state), unseen(log), unseen([{ scale: 2 }])), deeds, state.count, log.length, log.join(""));
