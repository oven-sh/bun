// break, continue and return leave the inner loop with the sum as it stands.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
function total(table) { let sum = 0; for (const row of table) for (const element of row) sum = sum + element; return sum; }
function some(table, most) { let sum = 0; for (const row of table) { for (const element of row) { if (element > 8) continue; if (sum > most) return "over " + sum; if (element < 0.2) break; sum = sum + element; } } return sum; }
const table = listOf(24, () => listOf(21, () => draw(9)));
console.log(some(table, 1e9), some(table, 300), some(table, 5));
