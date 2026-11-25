// What a loop has carried is changed behind it and seen by every name: several ways lead out of the loop.
const keep = [];
function boom(i) { if (i > 2) throw new Error("boom"); }
function f0(a, n) { let p = { x: 0.5, y: 1, z: 9 }, f; let i = 0; do { if (i === 2) break; p = i & 1 ? { x: p.x, y: p.y + 1, z: i } : { x: p.x + 1, y: p.y, z: i }; i++; } while (i < n); p.x += 10; return [p, f ? f() : 0]; }
function f1(a, n) { let p = { x: a, y: 1 }; for (let i = 0; i < n; i++) { if (i === 3) break; p = { x: p.y, y: p.x + i }; } p.x += 10; const q = p; p.y = a ? "t" : q.x; return [q, p === q]; }
function f2(a, n) { let p = { x: a, y: 1 }; let i = 0; for (;;) { if (i >= n) { p.x = -1; break; } if (i === 4) { p.y = -2; break; } p = { x: p.x + 1, y: p.y }; i++; } return a ? [p] : { p, i }; }
function f3(a, n) { let p = [a, 1]; let i = 0; while (true) { if (i === n) break; if (i === 3) { p[0] = "three"; break; } p = [p[1], p[0]]; i++; } p[1] += 5; return i & 1 ? [p, 1] : [p]; }
function f4(a, n) { let p = { x: a }; outer: for (let i = 0; i < n; i++) for (let j = 0; j < 3; j++) { p = { x: p.x + j }; if (p.x > 5) break outer; if (j === a) continue outer; } p.x *= 2; keep.push(p); p.x += 0.5; return keep.pop() === p ? p.x : "other"; }
function f5(a, n) { let p = { x: a, y: 0 }; try { for (let i = 0; ; i++) { if (i === n) break; p = { x: p.x + 1, y: i }; boom(p.x); } p.y = "end"; boom(n); } catch { p.x = -p.x; } return a ? [p, p.y] : p; }
function f6(a, n) { let p = { x: a }, q = null; for (let i = 0; i < n; i++) { if (i === 2) q = p; p = { x: p.x + 1 }; if (i === 3) return [p, q, p === q]; } p.x = "after"; return [p, q, p === q]; }
function* f7(a, n) { let p = { x: a, y: a }; let i = 0; do { p = { x: p.y, y: p.x + 1 }; if (i === 4) break; i++; yield p.x; } while (i < n); p.x += 100; keep.push(p); return [p, keep.length]; }
const show = v => JSON.stringify(v);
for (let round = 0; round < 3; round++) for (const a of [0, 1, 2.5]) for (const n of [0, 1, 2, 3, 5, 8]) {
  console.log(round, a, n, [f0, f1, f2, f3, f4, f5, f6].map(f => show(f(a, n))).join(" "), show([...f7(a, n)]), show(keep.splice(0)));
}
