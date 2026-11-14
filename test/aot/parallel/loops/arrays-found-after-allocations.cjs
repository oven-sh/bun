// Loops that fill an array made here beside arrays that are found after it was made: off fields, variables, rows, calls and getters. Some of them are the array that is filled, some become it while the loop runs.
class Box { constructor(n, half) { this.data = []; this.kept = null; this.rows = [[], []]; for (let i = 0; i < n; i++) { this.data.push(i * 7 % 13 + (half ? .5 : 0)); this.rows[i & 1].push(i * 3 % 11); } } get last() { return this.kept; } }
let shared = null;
function scaled(o) { const out = []; o.kept = out; const d = o.data; for (let i = 0; i < d.length; i++) out[i] = d[i] * 2 + d[i >> 1]; return out; }
function pushed(o) { const out = []; o.kept = out; const d = o.data; for (let i = 0; i < d.length; i++) out.push(d[i] * 2 + d[i >> 1]); return out; }
function own(o) { const out = []; o.kept = out; const d = o.last || o.data; let s = 0; for (let i = 0; i < d.length + 1; i++) { if (i > 50) break; out[i] = i + (d[i >> 1] || 0); s += d.length; } return out.concat(s); }
function doubled(o) { const out = [1, 2, 3]; o.kept = out; const d = o.last; for (let i = 0; i < d.length; i++) { if (d.length > 40) break; out.push(d[i] * 2); } return out; }
function variable(o) { const out = [4, 5]; shared = out; const d = o.pick(); let s = 0; for (let i = 0; i < d.length; i++) { if (i > 30) break; out[out.length] = d[i] + 1; s += d[0]; } return out.concat(s); }
function rows(o) { const out = []; o.rows[1] = out; const d = o.rows[0], e = o.rows[o.at]; let s = 0; for (let i = 0; i < d.length; i++) { out[i] = d[i] + e.length; s += e.length; } return out.concat(s); }
function both(o, p) { const out = [.5], d = o.data, e = p(out); let s = 0; for (let i = 0; i < d.length; i++) { out[i] = d[i] + (e[i & 3] || 0); s += e.length * d.length; } return out.concat(s); }
function nested(o) { const out = []; o.kept = out; let s = 0; for (let k = 0; k < 3; k++) { const d = k === o.at ? o.last : o.data; for (let i = 0; i < d.length; i++) { if (i > 40) break; out[i] = d[i] + k; s += d.length; } } return out.concat(s); }
function becomes(o) { const out = []; o.kept = out; let d = o.data, s = 0; for (let i = 0; i < d.length; i++) { if (i > 40) break; out[i] = d[i] + 1; if (i === o.at) d = o.last; s += d.length; } return out.concat(s); }
function shrinks(o) { const out = [9, 8, 7, 6, 5, 4, 3, 2, 1]; o.kept = out; const d = o.last; let s = 0; for (let i = 0; i < d.length; i++) { out[i] = i; if (i === o.at) out.length = 5; s += d.length; } return out.concat(s); }
function show(x) { if (!Array.isArray(x)) return String(x); let s = ""; for (let i = 0; i < x.length; i++) s += i in x ? (Object.is(x[i], -0) ? "-0" : String(x[i])) + " " : "- "; return s + x.length; }
let all = 0; const note = (n, s) => { for (let i = 0; i < s.length; i++) all = Math.imul(all, 31) + s.charCodeAt(i) | 0; console.log(n, s.length > 140 ? s.slice(0, 100) + s.slice(-40) : s); };
const run = (n, f) => { let r; try { r = show(f()); } catch (e) { r = e.name; } note(n, r); };
const kinds = { plain: () => new Box(20), half: () => new Box(21, true), few: () => new Box(3), none: () => new Box(0), holes: () => { const b = new Box(20); delete b.data[4]; return b; }, boxed: () => { const b = new Box(20); b.data[3] = "7"; return b; }, frozen: () => { const b = new Box(12); Object.freeze(b.data); return b; }, words: () => { const b = new Box(5); b.data = Int32Array.of(4, 5, 6, 7); return b; } };
for (const turn of [1, 2, 3]) for (const name of Object.keys(kinds)) {
  const o = at => Object.assign(kinds[name](), { at, pick() { return at ? shared : this.data; } });
  for (const at of [0, 1, 2, 7]) for (const f of [scaled, pushed, own, doubled, variable, rows, nested, becomes, shrinks]) run(f.name + " " + name + at, () => f(o(at)));
  run("both other " + name, () => both(o(1), () => [1, 2, 3])); run("both same " + name, () => both(o(1), x => x)); run("both rows " + name, () => { const b = o(1); return both(b, () => b.rows[0]); }); run("both data " + name, () => { const b = o(1); return both(b, () => b.data); });
}
console.log(all);
