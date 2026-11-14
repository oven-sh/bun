const out = [];
const show = v => (v instanceof Error ? v.name + ":" + v.message : Array.isArray(v) ? "[" + v.map(show) + "]" : Object.is(v, -0) ? "-0" : typeof v === "object" && v !== null ? "{" + Object.keys(v).map(k => k + ":" + show(v[k])) + "}" : typeof v === "function" ? "function" : String(v));
const log = (...values) => out.push(values.map(show).join(" "));
const list = JSON.parse("[3,0,51,12,8,99,7,50,-1,4]"), mixed = JSON.parse('[1,"2",null,4.5,true,60]');
let held = null, state = 0;
function folds(source) {
  let s = 0;
  for (let i = 0; i < source.length; i++) {
    const x = source[i];
    const r = x > 50 ? null : { v: x }; if (r) s += r.v;
    let a = null; if (x < 50) a = { v: x, w: i }; if (a) s += a.v + a.w; else s += 1000;
    let b; if (x < 50) b = { v: x, w: i }; if (b !== undefined) s += b.v * b.w;
    const c = (x & 1 ? { v: x } : null) || { v: 2 }; s += c.v;
    const d = (x & 1 ? { v: x } : undefined) ?? { v: 3 }; s += d.v;
    if (!(x & 2 ? { v: x } : null)) s += 7;
    const e = x > 10 ? { v: x, n: 1 } : x > 5 ? { v: i } : null; if (e !== null) s += e.v;
  }
  return s;
}
function keeps(source) {
  const all = [];
  for (let i = 0; i < source.length; i++) {
    const x = source[i];
    let o = null; if (i & 1) o = { v: x }; if (o) { o.v++; o.late = i; all.push(o); } else all.push(o);
    let p = i & 1 ? { v: x, get g() { state++; return x; } } : undefined; if (p) { held = p; all.push(p.g, held === p); }
    let q = null; if (i & 1) q = { next: q, v: x }; if (x > 7) q = { next: q, v: i }; for (let n = q; n; n = n.next) all.push(n.v);
    const f = i & 1 ? { v: () => x } : null; if (f) all.push(f.v()); const g = () => f; all.push(g()?.v === f?.v);
    let best = null; for (const score of [x, i, 4]) if (best === null || score > best.score) best = { score, i }; all.push(best);
    let t = null; try { if (x === 8) throw new RangeError("eight"); t = { ok: x }; } catch (error) { t = i & 1 ? { error } : null; } if (t) all.push(t);
  }
  return all;
}
class Link { constructor(v, next) { this.v = v; this.next = next; } }
function chains(source) { let s = 0; for (let i = 0; i < source.length; i++) { const x = source[i]; let head = null; if (i & 1) head = new Link(x, head); if (i & 2) head = new Link(i, head); for (let p = head; p !== null; p = p.next) s += Number(p.v) || 1; const first = head && head.v; s += first ? 1 : 0; } return s; }
const none = { v: 1, w: 2 }, pair = [5, 6], cache = new Map([[3, { v: 30, w: 1 }], [8, [80, 81]]]);
function shares(source) {
  const all = []; let s = 0;
  for (let i = 0; i < source.length; i++) {
    const x = source[i];
    const a = x < 50 ? { v: x, w: i } : none; s += Number(a.v * a.w) || 1;
    const b = cache.get(x) ?? { v: i, w: 3 }; s += Number(b.v) || 2; all.push(b === cache.get(x));
    let p = [x, i]; if (i & 1) p = [i, x]; s += Number(p[0] * 3 - p[1]) || 3;
    const q = i & 1 ? [x] : pair; s += Number(q[0]) + q.length || 4; all.push(q === pair, q[1]);
    const u = x < 9 ? [x, i, 1] : [x]; s += u.length; all.push(u.at(-1), u[2]);
    let m = i & 2 ? { v: x } : none; m.v === 1 ? all.push(m) : all.push(m.v); if (m !== none) m.v = i; all.push(m.v);
    let w = i & 1 ? [x, i] : pair; if (w !== pair) w[0] = 7; w = w[0] === 7 ? w : [w[1], 0]; all.push(w[0], w[1]);
    const o = held && i & 1 ? held : { v: x, w: 2 }; try { s += Number(o.w) || 0; } catch (error) { all.push(error.name); }
  }
  return [s, all];
}
for (let round = 0; round < 3; round++) { log(shares(list), shares(mixed)); log(folds(list), folds(mixed), chains(list), chains(mixed), state); log(keeps(list)); log(keeps(mixed)); log(held); }
console.log(out.join("\n"));
