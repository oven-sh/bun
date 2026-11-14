// Objects made in a loop before an array method and needed behind it in a few iterations are made there alone.
// STATISTIC: AllocationsSunk >= 11
const list = [4, 1, 3, 0, 2];
let later = null;
class Pair { a; b; constructor(a, b) { this.a = a; this.b = b; } }
function late(v) { later = v; }
let total = 0;
for (let k = 0; k < 200; k++) { const p = new Pair(k, 2); const s = list.reduce((a, v) => a + v, 0); if ((k & 15) === 3) late(p); total += s; }
console.log(total, later.a, later.b);
for (let k = 0; k < 200; k++) { const p = new Pair(k, 2); const s = list.filter(v => v > k).length; if ((k & 15) === 3) late(p); total += s; }
console.log(total, later.a, later.b);
for (let k = 0; k < 200; k++) { const p = () => k; const s = list.map(v => v * 2)[k % 3]; if ((k & 15) === 3) late(p); total += s; }
console.log(total, later());
for (let k = 0; k < 200; k++) { const p = new Pair(k, 1); const s = list.some(v => v > k) ? 1 : 2; if ((k & 15) === 3) late(p); total += s; if (k === 99) delete list[2]; }
console.log(total, later.a, later.b);
