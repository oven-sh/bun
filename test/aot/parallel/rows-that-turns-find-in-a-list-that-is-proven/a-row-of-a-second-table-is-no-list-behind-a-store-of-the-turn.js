// Each turn reads a row of one table, stores into a field, and reads a row of a second table: where that second row is no list the turn begins again, and the store must count once.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
const table = listOf(25, () => listOf(4, () => draw(20)));
const other = listOf(25, i => (i === 19 ? "wxyz" : i === 7 ? new Float64Array([1.5, 2.5, 3.5, 4.5]) : i === 0 ? { 0: 1, 1: 2, 2: 3, 3: 4 } : listOf(4, () => draw(20))));
const box = { n: 0 };
function sums(table, other, a, b, count) { let sa = 0, sb = 0; for (let i = 0; i < count; i++) { sa = sa + table[i][a]; box.n = box.n + 1; sb = sb + other[i][b]; } return sa + " " + sb; }
for (let a = 0; a < 4; a++) console.log(a, sums(table, other, a, (a + 1) % 4, 25), box.n);
