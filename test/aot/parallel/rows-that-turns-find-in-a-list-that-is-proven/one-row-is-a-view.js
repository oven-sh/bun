// One row is a view of doubles, one a view of bytes.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
function sums(table, a, b, count) { let sa = 0, sb = 0, ab = 0; for (let i = 0; i < count; i++) { sa = sa + table[i][a]; sb = sb + table[i][b]; ab = ab + table[i][a] * table[i][b]; } return sa + " " + sb + " " + ab; }
const table = listOf(30, i => (i === 11 ? new Float64Array([1.5, 2.5, 3.5, 4.5]) : i === 23 ? new Uint8Array([9, 8, 7, 6]) : listOf(4, () => draw(20))));
for (let a = 0; a < 4; a++) console.log(a, sums(table, a, (a + 2) % 4, table.length));
