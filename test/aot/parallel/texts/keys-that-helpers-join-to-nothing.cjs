// Helpers whose answers are read as keys join nothing, texts, pieces of texts, wide texts, whole numbers and what converts, in front and behind, gathered in loops and not.
"use strict";
const J = JSON.parse, out = [], log = [], src = J('"alpha,beta,,12,-0,007,\\u00e9t\\u00e9,\\u4f60\\u597d,x,__proto__,length,4294967295"'), wide = src + "\u4e00";
class R { constructor(s) { this.s = s; this.i = 0; } next() { const s = this.s; let out = "", from = this.i; for (;;) { const c = s.charCodeAt(this.i); if (c === 44 || c !== c) { out += s.slice(from, this.i++); return out; } if (c === 120) { out += s.slice(from, this.i) + "X"; from = ++this.i; } else this.i++; } } }
const front = a => "" + a, behind = a => a + "", both = (a, b) => a + b, three = (a, b, c) => a + b + c, gathered = l => { let k = ""; for (const x of l) k += x; return k; }, last = (l, e) => { let k = ""; for (const x of l) k += x + ","; return k + e; };
const said = v => ({ toString() { log.push("s"); return v; }, valueOf() { log.push("v"); return v; } });
const vs = ["", "a", src.slice(0, 5), src.slice(3, 3), src.slice(12, 14), src.slice(21, 24), wide.slice(-2), 0, -0, 7, -7, 1.5, 4294967295, 2147483648, NaN, null, undefined, true, 12n, [], ["q"], {}, said(""), said("w"), Symbol.iterator];
const put = (o, k, v) => { o[k] = v; return Object.keys(o).join(); };
for (let r = 0; r < 25; r++) { out.length = 0; const o = {}, m = new Map(), n = Object.create(null);
  for (const t of [src, wide]) { const p = new R(t); while (p.i <= t.length) { const k = p.next(); o[k] = p.i; n[k] = k; m.set(k, k.length); out.push(k, m.get(k), n[k] === k, k === "" + k, typeof k); } }
  for (const a of vs) for (const b of vs) for (const f of [x => o[front(x)] = 1, x => m.get(behind(x)), x => n[both(x, b)] = 2, x => o[three("", x, b)], x => o[gathered([x, b])] = 3, x => m.set(last([x], b), 4).size]) { try { out.push(String(f(a))); } catch (e) { out.push(e.name); } if (log.length) out.push(log.splice(0).join("")); }
  out.push(put({}, front(src.slice(6, 10)), 1), Object.keys(o).length, Object.keys(n).length, m.size); }
let h = 7; for (const x of out) { const t = String(x); for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0; } console.log(out.length, h, out.slice(0, 50).join("|"));
