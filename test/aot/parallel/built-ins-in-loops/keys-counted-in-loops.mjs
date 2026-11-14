// Loops fill, count in, group in, empty and replace the tables of the maps and sets that they look keys up in.
const words = "the quick brown fox jumps over the lazy dog and then the fox sleeps while the dog barks at the moon".split(" "), objects = Array.from({ length: 30 }, (_, i) => ({ i }));
const show = m => m.size + " " + [...m].slice(0, 5).map(e => Array.isArray(e) ? e.map(x => typeof x === "object" && x ? Object.keys(x).join() : Object.is(x, -0) ? "-0" : String(x)).join("=") : String(e)).join(";");
const keys = [i => i & 7, i => i % 97, i => i, i => i / 2, i => i % 3 ? -0 : 0, i => i % 4 ? NaN : i, i => words[i % words.length], i => "k" + i % 40, i => objects[i % 30], i => i % 9 ? objects[i % 5] : null, i => i & 1 ? i : words[i % 7], i => i + 2147483600];
function count(turns, key) { const m = new Map(); for (let i = 0; i < turns; i++) { const k = key(i); m.set(k, (m.get(k) ?? 0) + 1); } return show(m); }
function group(turns) { const m = new Map(); let n = 0; for (let i = 0; i < turns; i++) { const k = i % 13, l = m.get(k); if (l) { l.push(i); if (l.length > 4) l.length = 0; } else m.set(k, [i]); n += m.size; } return n + show(m); }
function groupWords(turns) { const m = new Map(); for (let i = 0; i < turns; i++) { const k = words[i % words.length], l = m.get(k); if (l) l.push(i); else m.set(k, [i]); } return show(m); }
function seen(turns, step) { const s = new Set(); let n = 0; for (let i = 0; i < turns; i++) { const x = (i * step) % 301; if (s.has(x)) n++; else s.add(x); if (i % 200 === 199) s.clear(); } return n + show(s); }
function memo(turns) { const m = new Map([[0, 0], [1, 1]]); let n = 0; for (let i = 2; i < turns; i++) { let v = m.get(i); if (v === undefined) { v = m.get(i - 1) + m.get(i - 2); m.set(i, i > 40 ? v / 3 : v); } n += v % 7; } return n.toFixed(3) + show(m); }
function widened(turns) { const m = new Map(); let n = 0; for (let i = 0; i < turns; i++) { const k = i & 3, v = m.get(k); n += v === undefined ? 1 : typeof v === "number" ? v : v.length; m.set(k, i < 20 ? i : i < 40 ? i / 8 : "late" + i); } return n + show(m); }
function emptied(turns) { const m = new Map(); let n = 0; for (let i = 0; i < turns; i++) { const k = i % 11; if (m.has(k)) { n++; if (i % 5 === 0) m.delete(k); } else m.set(k, i); if (i % 50 === 49) m.clear(); } return n + show(m); }
function other(turns) { const a = new Map(), b = new Map(); let n = 0; for (let i = 0; i < turns; i++) { const m = i & 1 ? a : b; if (a.get(i % 9) === undefined) m.set(i % 9, i); else n++; if (b.has(i % 5)) n += 2; } return n + show(a) + show(b); }
function grow(m, n) { for (let j = 0; j < n; j++) m.set(1000 + j, j); }
function called(turns) { const m = new Map(); let n = 0; for (let i = 0; i < turns; i++) { const v = m.get(i % 20); if (v === undefined) m.set(i % 20, i); else n += v; if (i % 100 === 60) grow(m, i); } return n + show(m); }
function thrown(turns) { const m = new Map(); let n = 0; for (let i = 0; i < turns; i++) { try { if (m.has(i % 7) && i % 10 === 0) throw new Error("at"); m.set(i % 7, i); } catch (error) { m.delete(i % 7); n += error.message.length; } } return n + show(m); }
for (const turns of [0, 1, 5, 9, 300, 3000]) {
  for (const key of keys) console.log(count(turns, key));
  console.log(group(turns), groupWords(turns), seen(turns, 7), seen(turns, 1), memo(Math.min(turns, 80)), widened(turns), emptied(turns), other(turns), called(turns), thrown(turns));
}
