// The table is made here, so that it is proven to be a list and nothing is left to ask in front of the loop; its rows are known only by their use.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
function sums(table, a, b, count) { let sa = 0, sb = 0, ab = 0; for (let i = 0; i < count; i++) { sa = sa + table[i][a]; sb = sb + table[i][b]; ab = ab + table[i][a] * table[i][b]; } return sa + " " + sb + " " + ab; }
const table = listOf(40, () => listOf(5, () => draw(50)));
for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) console.log(a, b, sums(table, a, b, table.length));
