function point(x, y) { const p = {}; p.x = x; p.y = y; return p; }
function sum(p) { return p.x + p.y; }

function knot(n) { const k = { n }; k.self = k; k.after = n + 1; return k; }
function readKnot(k) { return k.self === k ? k.after : -1; }

function guarded(give) { let g; try { g = { a: 1 }; g.b = give(); g.c = 3; return g; } catch { return g; } }
function readGuarded(g) { return g.a + ":" + g.b + ":" + g.c + ":" + ("c" in g); }

function forked(on) { const f = { a: 1 }; if (on) f.b = 2; return f; }
function readForked(f) { return f.b === undefined ? "none" : f.b; }

function chained(n) { const c = {}; c.first = n; const seen = c.first; c.second = seen + 1; return c; }
function readChained(c) { return c.first * 10 + c.second; }

function caught(n) { const h = {}; const get = () => h.late; h.late = n; return [h, get]; }
function readCaught(pair) { return pair[0].late + pair[1](); }

function dropped(n) { const d = {}; d.kept = n; d.gone = n; delete d.gone; return d; }
function readDropped(d) { return d.kept + ":" + d.gone + ":" + Object.keys(d).join(); }

function broken(n) { const b = {}; b.one = n; if (n % 7 === 3) throw b; b.two = n + 1; return b; }
function readBroken(b) { return b.one + ":" + b.two; }

function pushed(count) { const out = []; for (let i = 0; i < count; i++) { const e = {}; e.i = i; e.twice = i * 2; out.push(e); } return out; }
function readPushed(list) { let total = 0; for (const e of list) total += e.i + e.twice; return total; }

function handed(n, sink) { const h = {}; h.early = n; sink(h); h.late = n + 1; return h; }
const seenEarly = [];
function look(h) { seenEarly.push(h.early + ":" + h.late); }

let last = "";
for (let turn = 0; turn < 300; turn++) {
  const lines = [];
  lines.push(sum(point(turn, 1)));
  lines.push(readKnot(knot(turn)));
  lines.push(readGuarded(guarded(() => turn)));
  lines.push(readGuarded(guarded(() => { throw new Error("no"); })));
  lines.push(readForked(forked(turn % 2 === 0)), readForked(forked(turn % 2 === 1)));
  lines.push(readChained(chained(turn)));
  lines.push(readCaught(caught(turn)));
  lines.push(readDropped(dropped(turn)));
  try { lines.push(readBroken(broken(turn))); } catch (thrown) { lines.push("thrown " + readBroken(thrown)); }
  lines.push(readPushed(pushed(5)));
  seenEarly.length = 0;
  lines.push(handed(turn, look).late, seenEarly.join());
  last = lines.join(" | ");
}
console.log(last);
