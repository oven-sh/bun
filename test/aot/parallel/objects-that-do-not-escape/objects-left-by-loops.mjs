// What a loop carries and the code after it sees is allocated where the loop is left, once.
// STATISTIC: MergedHeaderObjectsAllocated >= 3
// STATISTIC: MergedJoinObjectsAllocated >= 2
// STATISTIC: MergedObjectsAllocatedOnEdges >= 2
class V { constructor(x, y) { this.x = x; this.y = y; } add(o) { return new V(this.x + o.x, this.y + o.y); } scale(k) { return new V(this.x * k, this.y * k); } }
const keep = [], list = [5, 3, 8, 1, 9, 2];
function returned(n, d) { let p = new V(0, 1); for (let i = 0; i < n; i++) p = p.add(d); return p; }
function sometimes(n, d) { let p = new V(0, 1); for (let i = 0; i < n; i++) if (i & 1) p = p.add(d); return p; }
function changed(n, d) { let p = new V(0, 1); for (let i = 0; i < n; i++) { p = p.add(d); p.y += 0.5; } p.x = -p.x; keep.push(p); return p; }
function afterJoin(n, d) { let p = new V(0, 1), i = 0; do { if (i & 1) p = p.add(d); } while (++i < n); return p; }
function eitherWay(n, d) { let p = new V(0, 1), i = 0; for (;;) { p = i & 1 ? p.add(d) : p; if (++i >= n) return p; } }
function severalExits(n, d) { let p = new V(0, 1); for (let i = 0; i < n; i++) { p = p.add(d); if (p.x > 6) { p.x = "left"; keep.push(p); break; } if (p.y < -3) return p.scale(2); } return p; }
function nested(n, d) { let p = new V(0, 1); for (let i = 0; i < 2; i++) { for (let j = 0; j < n; j++) p = p.add(d); p.x += 100; } return p; }
function labelled(n, d) { let p = { x: 0, y: 0 }; outer: for (let i = 0; i < 3; i++) for (let j = 0; j < n; j++) { p = { x: p.x + j, y: p.y + i }; if (j === 2) continue outer; if (p.x > 9) break outer; } return p; }
function pair(n) { let p = [0, 1]; for (let i = 0; i < n; i++) p = [p[1], p[0] + p[1]]; keep.push(p); return p; }
function best() { let b = { x: -1, at: -1 }; for (let i = 0; i < list.length; i++) if (list[i] > b.x) b = { x: list[i], at: i }; return b; }
function summed() { return list.reduce((a, v) => ({ x: a.x + v, y: a.y + 1 }), { x: 0, y: 0 }); }
function states(n) { let s = { x: 0, y: 0 }; for (let i = 0; i < n; i++) { switch (s.x) { case 0: s = { x: 1, y: s.y + i }; break; case 1: s = { x: 2, y: s.y * 2 }; break; default: s = { x: 0, y: s.y - 1 }; } } return s; }
function twoObjects(n, d) { let a = new V(0, 1), b = new V(1, 0); for (let i = 0; i < n; i++) { if (i & 1) a = a.add(b); else b = b.add(a); if (i === 5) a = b = d; } return [a, b, a === b]; }
function caught(n, d) { let p = new V(0, 1); try { for (let i = 0; i < n; i++) { p = p.add(d); if (i === 4) throw p; } } catch (e) { e.x = "caught"; return [p, p === e]; } finally { keep.push(p); } return p; }
function* yielded(n, d) { let p = new V(0, 1); for (let i = 0; i < n; i++) p = p.add(d); yield p; for (let i = 0; i < n; i++) { p = p.scale(2); yield p.x; } return p; }
const show = v => JSON.stringify(v);
for (let round = 0; round < 3; round++) for (const n of [0, 1, 2, 5, 7]) for (const d of [new V(1, 2), new V(0.5, -2), new V("t", 1)]) {
  console.log(round, n, [returned, sometimes, changed, afterJoin, eitherWay, severalExits, nested, labelled, pair, best, summed, states, twoObjects, caught].map(f => show(f(n, d))).join(" "), show([...yielded(n, d)]), show(keep.splice(0)), keep.length);
}
