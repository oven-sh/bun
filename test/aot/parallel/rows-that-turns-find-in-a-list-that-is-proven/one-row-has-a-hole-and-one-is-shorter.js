// A hole in one row, and one row that is shorter than the others: the read finds nothing there.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
function sums(table, a, b, count) { let sa = 0, sb = 0, ab = 0; for (let i = 0; i < count; i++) { sa = sa + table[i][a]; sb = sb + table[i][b]; ab = ab + table[i][a] * table[i][b]; } return sa + " " + sb + " " + ab; }
const table = listOf(25, i => { const row = listOf(4, () => draw(20)); if (i === 9) delete row[1]; if (i === 15) row.length = 2; return row; });
for (let a = 0; a < 4; a++) console.log(a, sums(table, a, (a + 1) % 4, table.length));
