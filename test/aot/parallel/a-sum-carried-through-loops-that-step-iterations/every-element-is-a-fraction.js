// The sum goes through both loops; the plain walk of the outer one finds it a number or a text.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
function total(table) { let sum = 0; for (const row of table) for (const element of row) sum = sum + element; return sum; }
console.log(total(listOf(24, () => listOf(21, () => draw(50)))));
