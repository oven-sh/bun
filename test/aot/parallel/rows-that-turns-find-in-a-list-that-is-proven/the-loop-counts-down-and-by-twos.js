// The counter goes down, and up by two.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
const table = listOf(31, i => (i === 6 ? "wxyz" : listOf(4, () => draw(20))));
function down(table, a) { let sa = 0; for (let i = table.length - 1; i >= 0; i--) sa = sa + table[i][a]; return sa; }
function byTwos(table, a) { let sa = 0; for (let i = 1; i < table.length; i += 2) sa = sa + table[i][a] * table[i - 1].length; return sa; }
for (let a = 0; a < 4; a++) console.log(a, down(table, a), byTwos(table, a));
