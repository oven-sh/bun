// The native random: draws differ, shuffles are permutations, sums hold, whatever the list holds and wherever a turn leaves its typed version.
const lists = [[1, 2, 3, 4, 5, 6, 7, 8], [1.5, 2, 3], ["a", "b", "c", "d"], [1, "b", null, undefined, 2n, {}], [1, , 3, , 5], new Int32Array([4, 5, 6, 7]), new Float64Array([1.5, 2.5]), Object.freeze([1, 2, 3])];
class Holder {
  constructor(list) { this.fill(list); }
  fill(list) { this.list = list; this.draws = []; }
  shuffle() { for (let i = this.list.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = this.list[i]; this.list[i] = this.list[j]; this.list[j] = t; } }
  sample(n, scale) { let seen = 0; for (let i = 0; i < n; i++) { const v = this.list[Math.floor(Math.random() * scale)]; if (v !== undefined) seen++; } return seen; }
  draw(n) { for (let i = 0; i < n; i++) this.draws[i] = Math.random(); return new Set(this.draws).size; }
  pairs(n) { let equal = 0; for (let i = 0; i < n; i++) if (Math.random() === Math.random()) equal++; return equal; }
  stored(n) { let last = -1, same = 0; for (let i = 0; i < n; i++) { const r = Math.random(); if (r === last) same++; last = r; this.draws[Math.floor(r * 4)] = r; } return same; }
}
const key = v => typeof v + String(typeof v === "object" ? JSON.stringify(v) : v);
let bad = 0;
for (let turn = 0; turn < 6; turn++) {
  for (const list of lists) {
    const before = Array.from(list, key).sort().join(), holder = new Holder(list);
    let thrown = "";
    try { holder.shuffle(); } catch (e) { thrown = e.name; }
    if (Array.from(list, key).sort().join() !== before && !(list === lists[4])) bad++;
    const inside = holder.sample(400, list.length), outside = holder.sample(400, -5), beyond = holder.sample(400, list.length * 1e9);
    if (outside !== 0 || beyond > 5 || (list !== lists[3] && list !== lists[4] && inside !== 400)) bad++;
    if (holder.draw(500) < 495 || holder.pairs(300) > 0 || holder.stored(300) > 0 || holder.draws.some(r => !(r >= 0 && r < 1))) bad++;
    if (thrown && list !== lists[7]) bad++;
  }
}
console.log("bad", bad);
