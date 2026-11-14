// for-of loops that fill an array made here beside an array that is found after it was made and that may be the very array: pushes, stores, lengths, breaks, and arrays that grow or shrink while they are iterated.
class Box { constructor(n, half) { this.data = []; this.kept = null; this.rows = [[], []]; this.at = 0; for (let i = 0; i < n; i++) { this.data.push(i * 7 % 13 + (half ? .5 : 0)); this.rows[i & 1].push(i * 3 % 11); } } get last() { return this.kept; } pick() { return this.at ? shared : this.data; } }
let shared = null;
function pushed(o) { const out = []; for (const x of o.data) out.push(x * 2); return out; }
function kept(o) { const out = []; o.kept = out; for (const x of o.data) out.push(x * 2); return out; }
function own(o) { const out = [1, 2, 3]; o.kept = out; let g = 0; for (const x of o.last) { if (g++ > 30) break; out.push(x * 2); } return out; }
function choice(o) { const out = [.5, 1.5]; o.kept = out; let g = 0; for (const x of o.at ? o.last : o.data) { if (g++ > 30) break; out.push(x + 1); } return out; }
function stored(o) { const out = []; shared = out; let i = 0; for (const x of o.pick()) { if (i > 30) break; out[i++] = x * 2 + out.length; } return out; }
function lengths(o) { const out = [4, 5, 6]; o.kept = out; const d = o.at ? o.last : o.data; let s = 0, g = 0; for (const x of d) { if (g++ > 30) break; out.push(x); s += d.length; } return out.concat(s); }
function shrinks(o) { const out = [9, 8, 7, 6, 5, 4, 3]; o.kept = out; let s = 0; for (const x of o.last) { s = s * 3 + x; if (x === 7) out.length = 5; } return out.concat(s); }
function nested(o) { const out = []; for (const r of o.rows) for (const x of r) out.push(x + r.length); return out; }
function nestedOwn(o) { const out = [1, 2]; o.rows[1] = out; let g = 0; for (const r of o.rows) for (const x of r) { if (g++ > 30) return out; out.push(x + r.length); } return out; }
function counted(o) { const out = [3, 1, 2]; o.kept = out; const d = o.at ? o.last : o.data; let s = 0; for (let i = d.length - 1; i >= 0; i--) { out.push(d[i] * 2); s += d.length; } return out.concat(s); }
function filtered(o) { const out = [], rest = []; o.kept = rest; for (const x of o.at ? o.last : o.data) if (x > 5) out.push(x); else rest.push(x); return out.concat(rest); }
function entries(o) { const out = []; o.kept = out; for (const [i, x] of o.data.entries()) out[i] = x * i; return out; }
function show(x) { if (!Array.isArray(x)) return String(x); let s = ""; for (let i = 0; i < x.length; i++) s += i in x ? (Object.is(x[i], -0) ? "-0" : String(x[i])) + " " : "- "; return s + x.length; }
let all = 0; const note = (n, s) => { for (let i = 0; i < s.length; i++) all = Math.imul(all, 31) + s.charCodeAt(i) | 0; console.log(n, s.length > 140 ? s.slice(0, 100) + s.slice(-40) : s); };
const run = (n, f) => { let r; try { r = show(f()); } catch (e) { r = e.name; } note(n, r); };
const kinds = { plain: () => new Box(20), half: () => new Box(21, true), few: () => new Box(3), none: () => new Box(0), holes: () => { const b = new Box(20); delete b.data[4]; return b; } };
for (const turn of [1, 2, 3]) for (const name of Object.keys(kinds)) for (const at of [0, 1]) for (const f of [pushed, kept, own, choice, stored, lengths, shrinks, nested, nestedOwn, counted, filtered, entries])
  run(f.name + " " + name + at, () => { const b = kinds[name](); b.at = at; return f(b); });
console.log(all);
