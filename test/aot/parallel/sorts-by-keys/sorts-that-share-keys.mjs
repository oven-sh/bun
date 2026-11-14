// STATISTIC: SortComparatorCallsElided >= 3
// Env: BUN_JSC_slowPathAllocsBetweenGCs=5
// One array keeps the keys of one sort after the other: of short and long arrays, of sorts within comparators and within keys, of sorts that throw, and behind collections.
class Item { constructor(id, x) { this.id = id; this.x = x; this.parts = [{ y: x % 3 }, { y: (x * 7) % 5 }, { y: 1 }]; } }
const make = (count, step) => Array.from({ length: count }, (_, i) => new Item(i, (i * step) % 13));
const show = list => list.map(item => item.id).join();
function byField(list) { list.sort((a, b) => a.x - b.x); return list; }
function down(list) { list.sort((a, b) => b.x - a.x); return list; }
function byHalves(list) { list.sort((a, b) => a.x / 2 - b.x / 2); return list; }
function inner(item) { item.parts.sort((a, b) => a.y - b.y); return item.parts[0].y; }
function byInner(list) { list.sort((a, b) => inner(a) - inner(b)); return list; }
function within(list) { let calls = 0; list.sort((a, b) => { byField([b, a]); calls++; return a.x - b.x || b.id - a.id; }); return list.length && calls > 0; }
function throwing(list) { try { list.sort((a, b) => { if (a.id === 2 && b.id === 5) throw new RangeError("two"); return a.x - b.x; }); } catch (error) { return error.message; } return show(list); }
function mixed(list) { list.sort((a, b) => a.x - b.x); return list; }
const lines = [];
for (let round = 0; round < 6; round++) {
  for (const count of [2, 3, 5, 8, 9, 31, 32, 33, 40, 100, 4]) {
    lines.push(show(byField(make(count, 5 + round))), show(down(make(count, 3))), show(byHalves(make(count, 7))), show(byInner(make(count, 11))), within(make(count, 4)), throwing(make(count, 6)));
    const odd = make(count, 5); odd[1].x = round % 2 ? NaN : "7"; lines.push(show(mixed(odd)));
    const empty = make(count, 5); empty[0].x = undefined; lines.push(show(mixed(empty)));
  }
  const kept = []; for (let i = 0; i < 400; i++) kept.push({ i, list: [i] }); lines.push(kept.length);
}
let hash = 0; for (const line of lines) for (const character of String(line)) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) | 0;
console.log(lines.length, hash, lines.slice(0, 9).join(" | "));
