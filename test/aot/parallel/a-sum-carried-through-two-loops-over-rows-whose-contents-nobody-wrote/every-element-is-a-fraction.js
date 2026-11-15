// The helper that makes the lists says nothing of what they hold; the sum goes through both loops.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
function total(table) { let sum = 0; for (let i = 0; i < table.length; i++) { const row = table[i]; for (let j = 0; j < row.length; j++) sum = sum + row[j]; } return sum; }
console.log(total(listOf(24, () => listOf(21, () => draw(50)))));
