// The count that ends the loop is larger than the table: the read off what is not there throws.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
function sums(table, a, b, count) { let sa = 0, sb = 0, ab = 0; for (let i = 0; i < count; i++) { sa = sa + table[i][a]; sb = sb + table[i][b]; ab = ab + table[i][a] * table[i][b]; } return sa + " " + sb + " " + ab; }
const table = listOf(12, () => listOf(4, () => draw(20)));
for (const count of [0, 1, 12, 13]) { try { console.log(count, sums(table, 0, 1, count)); } catch (error) { console.log(count, error.constructor.name); } }
