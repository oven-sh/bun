// One row is an object whose getter runs code in the middle of a turn: it replaces the rows behind it and lengthens the table.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
function sums(table, a, b, count) { let sa = 0, sb = 0, ab = 0; for (let i = 0; i < count; i++) { sa = sa + table[i][a]; sb = sb + table[i][b]; ab = ab + table[i][a] * table[i][b]; } return sa + " " + sb + " " + ab; }
const table = listOf(25, () => listOf(4, () => draw(20)));
let calls = 0;
table[7] = { get 0() { calls++; table[8] = [100, 200, 300, 400]; table[9] = "abcd"; table.push([1, 1, 1, 1]); return 0.5; }, 1: 1.5, 2: 2.5, 3: 3.5 };
for (let a = 0; a < 4; a++) console.log(a, sums(table, a, (a + 1) % 4, 25), calls, table.length);
