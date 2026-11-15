// Loops that step a generator anywhere in a turn: behind conditions, in front of tests, in the middle of effects.
let state = 0;
const lines = [];
const say = (...words) => lines.length < 3000 && lines.push(words.map(v => (typeof v === "object" && v !== null ? JSON.stringify(v) : String(v))).join(" "));
const list = JSON.parse("[3,1,4,1,5,9,2,6]");

function* range(a, b) { for (let k = a; k < b; k++) yield k; return "end"; }
function* sums(v) { let t = v; for (let k = 0; k < 5; k++) { const got = yield t; t += got === undefined ? 1 : got; } return t; }
function* guarded(v) { try { yield v; state++; yield v + 1; if (v === 2) throw new Error("two"); yield v + 2; } catch (error) { yield error.message; } finally { state += 10; say("finally", v); } }
function* single(v) { yield { v }; return v; }
function* nothing() {}

function whileTrue(g) { let s = ""; while (true) { const r = g.next(); if (r.done) break; s += r.value + ","; } return s; }
function forEver(v) { const it = range(v, 8); let s = 0; for (;;) { const { value, done } = it.next(); if (done) break; if (value === 6) continue; s += value; } return s; }
function trueLoop(v) { const it = range(0, v); let s = 0; while (true) { const r = it.next(); if (r.done) break; s += r.value; } return s; }
function last(v) { const it = sums(v); while (true) { const r = it.next(); if (r.done) return "last " + r.value; state += r.value; } }
function doWhile(v) { const it = range(v, 6); let r; let s = 0; do { r = it.next(); if (!r.done) s = s * 2 + r.value; } while (!r.done); return s + ":" + r.value; }
function effects(v) { const it = guarded(v); const order = []; let n = 0; while (n++ < 10) { order.push("front" + n + state); const r = it.next(); order.push("step" + state); if (r.done) break; order.push(r.value); } return order.join(); }
function bounded(v) { const it = sums(v); let s = 0; let n = 0; while (n < v) { n++; const r = it.next(); if (r.done) break; s += r.value; } return s + ":" + n; }
function sending(v) { const it = sums(v); let s = 0; let k = 0; while (true) { const r = it.next(k++); if (r.done) { s += r.value * 100; break; } s += r.value; } return s; }
function inverse(v) { const it = range(0, v); let s = 0; for (;;) { const r = it.next(); if (!r.done) { s += r.value; continue; } break; } return s; }
function kept(v) { const it = single(v); const all = []; while (true) { const r = it.next(); all.push(r); if (r.done) break; } return all.map(r => JSON.stringify(r)).join(); }
function nested(v) { let s = 0; const it = range(0, v); while (true) { const r = it.next(); if (r.done) break; const inner = range(r.value, v); do { const q = inner.next(); if (q.done) break; if (q.value > 6) break; s += q.value; } while (true); } return s; }
function labeled(v) { const it = range(0, 20); let s = 0; outer: while (true) { const r = it.next(); if (r.done) break; for (let k = 0; k < 3; k++) { if (r.value % 5 === k) continue outer; if (r.value > v + 8) break outer; s += k; } s += r.value; } return s; }
function thrown(v) { const it = guarded(v); let s = 0; while (true) { const r = it.next(); if (r.done) return s; if (s > 8) throw new RangeError("s" + s); s += typeof r.value === "number" ? r.value : 50; } }
function empty() { const it = nothing(); let n = 0; while (true) { const r = it.next(); n++; if (r.done) return n + ":" + r.value; } }
function closures(v) { const it = range(0, v); const all = []; while (true) { const r = it.next(); if (r.done) break; all.push(() => r.value * v); } return all.map(f => f()).join(); }
function assigned(v) { const it = range(v, 9); let r = null; let s = 0; while (!(r = it.next()).done && s < 20) s += r.value; return s + ":" + r.done + ":" + r.value; }

const attempt = f => { try { return f(); } catch (error) { return error.name + " " + error.message; } };
const all = [v => whileTrue(range(0, v)), forEver, trueLoop, last, doWhile, effects, bounded, sending, inverse, kept, nested, labeled, thrown, empty, closures, assigned];
for (let turn = 0; turn < 40; turn++) {
  for (const v of list) {
    const answers = all.map(f => attempt(() => f(v)));
    if (turn % 39 === 0) say(...answers, state);
  }
}
for (const line of lines.slice(0, 60).concat(lines.slice(-12))) console.log(line);
console.log(lines.length, state);
