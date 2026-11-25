const kept = [];
function keep(value) { if (kept.length < 40) kept.push(value); }
// two names of one object come round
function twice(n) { let p = { x: 1 }, q = { x: 3 }; let s = 0; for (let i = 0; i < n; i++) { p.x += 10; s += q.x; const o = { x: p.x + q.x }; p = o; q = o; } return [s, p.x, q.x]; }
function twiceSometimes(n) { let p = { x: 1, y: 2 }, q = { x: 3, y: 4 }; let s = 0; for (let i = 0; i < n; i++) { p.x += 10; s += q.x + q.y; if (i % 3) { p = { x: i, y: 1 }; q = { x: 2, y: i }; } else { const o = { x: p.x, y: q.y }; p = o; q = o; } q.y++; s += p.y; } return [s, p.x, p.y, q.x, q.y]; }
function swapped(n) { let p = { x: 1 }, q = { x: 3 }; let s = 0; for (let i = 0; i < n; i++) { p.x += i; s = (s * 3 + q.x) % 1000003; const o = q; q = p; p = { x: o.x + 1 }; } return [s, p.x, q.x]; }
function follows(n) { let p = { x: 1 }, last = { x: 0 }; let s = 0; for (let i = 0; i < n; i++) { last = p; p = { x: p.x + 1 }; last.x *= 2; s += last.x; if (i % 4 === 0) { last = p; last.x += 100; } s += p.x + last.x; } return [s, p.x, last.x]; }
function entersTwice(n) { const o = { x: 1 }; let p = o, q = o; let s = 0; for (let i = 0; i < n; i++) { p.x += 10; s += q.x; p = { x: i }; if (i % 2) q = { x: s % 7 }; } return [s, p.x, q.x, o.x]; }
// stores by one name, reads by the other
function aliasInLoop(n) { let s = 0; for (let i = 0; i < n; i++) { const a = { x: i, y: 1 }; const b = i % 3 ? a : { x: 5, y: 6 }; b.x = i * 7; s += a.x; b.y = 2; s += a.y + b.x; keep(b); } return s; }
function aliasRound(n) { let s = 0; const first = { x: 1, y: 0 }; let o = first; for (let i = 0; i < n; i++) { o.x = i; s += first.x; o.y = s; s += first.y; if (i === 5) o = { x: 100, y: 200 }; } return [s, first.x, first.y, o.x, o.y]; }
function aliasKept(n) { let s = 0; let o = { x: 1, y: 0 }; keep(o); for (let i = 0; i < n; i++) { o.x = i; s += kept[kept.length - 1].x; o.y = s; if (i % 5 === 4) { o = { x: s, y: i }; keep(o); } } return [s, o.x, o.y]; }
function aliasOfHolder(n) { let s = 0; const holder = { o: { x: 1 } }; let o = holder.o; for (let i = 0; i < n; i++) { o.x = i; s += holder.o.x; if (i % 3 === 2) { o = { x: i * 2 }; if (i % 2) holder.o = o; } } return [s, o.x, holder.o.x]; }
function thrown(n) { let s = 0; let o = { x: 1, y: 1 }; for (let i = 0; i < n; i++) { try { o.x = i; if (i % 4 === 3) throw o; o.y = i; o = { x: s, y: o.x }; } catch (e) { s += e.x + e.y; e.x = 9; s += o.x; } } return [s, o.x, o.y]; }
// objects of a caller
function step(o, n) { for (let i = 0; i < n; i++) { if (i & 1) o = { x: o.x + 1, y: o.y }; else { o.x += 1; o.y = i; } } return o.x * 10 + o.y; }
function callers(n) { let s = 0; for (let i = 0; i < n; i++) { const o = { x: i, y: 5 }; const r = step(o, 4); s = (s * 7 + r * 1000 + o.x * 10 + o.y) % 1000003; } return s; }
class Walker {
    constructor() { this.x = 0; this.n = 0; }
    walk(o, n) { for (let i = 0; i < n; i++) { o.x += 1; if (i % 2 === 1) o = { x: o.x * 2 }; } return o.x; }
    run(n) { let s = 0; for (let i = 0; i < n; i++) { const o = { x: i }; s += this.walk(o, 3); s = (s * 5 + o.x) % 1000003; } return s; }
}
function nestedLoops(n) { let s = 0; let outer = { x: 0, y: 1 }; for (let i = 0; i < n; i++) { let inner = outer; for (let j = 0; j < 4; j++) { inner.x += j; if (j === 2) inner = { x: inner.x, y: j }; s += outer.x; } outer = { x: inner.x, y: outer.x }; s = (s * 3 + outer.y) % 1000003; } return [s, outer.x, outer.y]; }
function innerTakesOver(n) { let s = 0; let o = { x: 1 }; for (let i = 0; i < n; i++) { const before = o; for (let j = 0; j < 3; j++) { o.x++; o = { x: o.x + j }; } s = (s * 3 + before.x + o.x) % 1000003; } return [s, o.x]; }
// an iteration that starts again in the other version of its loop
class Ball { constructor(d) { this.d = d; } hit(t) { return { at: this.d + t, name: "ball" }; } }
class Wall { constructor(d) { this.d = d; } hit(t) { return { at: this.d * 2 + t, name: "wall" }; } }
class Odd { constructor(d) { this.name = d; this.d = d; } hit(t) { return { name: "odd", at: String(this.d + t), more: 1 }; } }
function nearest(list, t) { let best = { at: 1e9, name: "none" }; let seen = 0; for (let i = 0; i < list.length; i++) { const thing = list[i]; best.at += 0.25; if (thing === null) continue; const r = thing.hit(t); if (r.at < best.at) { best = r; seen++; } } best.name += seen; return best; }
function nearestOfNumbers(list) { let best = { at: 1e9, place: -1 }; for (let i = 0; i < list.length; i++) { best.at -= 0.5; const d = list[i].d; if (d < best.at) best = { at: d, place: i }; } return best; }
const plain = [], mixed = [];
for (let i = 0; i < 40; i++) { plain.push(i % 2 ? new Ball((i * 37) % 41) : new Wall((i * 17) % 23)); mixed.push(i % 7 === 5 ? new Odd((i * 3) % 11) : i % 11 === 10 ? null : i % 2 ? new Ball((i * 37) % 41) : new Wall((i * 17) % 23)); }
const say = value => console.log(JSON.stringify(value));
for (const n of [0, 1, 2, 3, 7, 20, 400]) {
    say([twice(n), twiceSometimes(n), swapped(n), follows(n), entersTwice(n)]);
    say([aliasInLoop(n), aliasRound(n), aliasKept(n), aliasOfHolder(n), thrown(n)]);
    say([callers(n), new Walker().run(n), nestedLoops(n), innerTakesOver(n)]);
}
for (let t = 0; t < 5; t++) say([nearest(plain, t), nearest(mixed, t), nearest(plain.slice(0, 1), t), nearest([], t), nearestOfNumbers(plain), nearestOfNumbers(mixed.filter(e => e))]);
say(nearestOfNumbers([{ d: 5 }, { d: "4" }, { d: 3n === 3n ? 3 : 0 }, { e: 1, d: 2 }, { d: -1.5 }]));
say(kept);
