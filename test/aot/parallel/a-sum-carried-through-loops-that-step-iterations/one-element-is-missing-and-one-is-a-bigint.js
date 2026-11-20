// A hole and an undefined make the sum NaN; a bigint throws in its turn, and the iterations are closed.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
function total(table) { let sum = 0; for (const row of table) for (const element of row) sum = sum + element; return sum; }
const table = listOf(24, i => listOf(21, k => (i === 20 && k === 3 ? undefined : draw(9)))); delete table[22][5];
console.log(total(table), total(table.slice(0, 20)), total(table.slice(21, 22)));
table[4][7] = 5n;
try { console.log(total(table)); } catch (error) { console.log(error.constructor.name, error.message); }
