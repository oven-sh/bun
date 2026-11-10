// One element of the table is undefined: the read off it throws in that turn and in no other.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
function sums(table, a, b, count) { let sa = 0, sb = 0, ab = 0; for (let i = 0; i < count; i++) { sa = sa + table[i][a]; sb = sb + table[i][b]; ab = ab + table[i][a] * table[i][b]; } return sa + " " + sb + " " + ab; }
const table = listOf(25, i => (i === 21 ? undefined : listOf(4, () => draw(20))));
let turns = 0;
function counted(a, b) { let sa = 0; try { for (let i = 0; i < table.length; i++) { turns = i; sa = sa + table[i][a] * table[i][b]; } } catch (error) { return error.constructor.name + " in turn " + turns + " behind " + sa; } return sa; }
for (let a = 0; a < 4; a++) console.log(a, counted(a, (a + 1) % 4));
try { console.log(sums(table, 0, 1, table.length)); } catch (error) { console.log(error.constructor.name); }
