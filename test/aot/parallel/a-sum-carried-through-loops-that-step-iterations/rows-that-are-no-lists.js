// A set, a view, a generator, the values of a map and a text between the lists.
let seed = 7;
function draw(most) { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return Math.round(seed / 0x7fffffff * most * 100) / 100; }
function listOf(count, make) { const list = []; for (let i = 0; i < count; i++) list.push(make(i)); return list; }
function total(table) { let sum = 0; for (const row of table) for (const element of row) sum = sum + element; return sum; }
function* made() { yield 1.5; yield 2.5; }
console.log(total(listOf(24, i => (i === 3 ? new Set([1.25, 2.25]) : i === 7 ? new Float64Array([0.5, 1.5]) : i === 11 ? made() : i === 15 ? new Map([[1, 4.5]]).values() : i === 19 ? "12" : listOf(21, () => draw(9))))));
