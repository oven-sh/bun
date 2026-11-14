// `if (m.has(k)) return m.get(k)` with small numbers asks the entry at the place k first: other orders, deletes, clears, growth, narrow and wide values, names first.
// STATISTIC: NumbersFoundAtHomeSlots >= 1
function memo(f, m = new Map()) { const g = x => { if (m.has(x)) return m.get(x); const v = f(x); m.set(x, v); return v; }; g.m = m; return g; }
function changing(f, m) { const g = x => { if (m.has(x)) { const v = m.get(x); if (x === 5) m.delete(x - 1); if (x === 9 && m.size > 30) m.clear(); return v; } m.set(x, f(x)); return -1; }; g.m = m; return g; }
const squares = memo(x => x * x);
function sum(turns) { let n = 0; for (let k = 0; k < turns; k++) n += squares(k & 31); return n; }
console.log(sum(1000), sum(0), sum(40), squares.m.size);
const show = v => (typeof v === "object" && v ? "{" + Object.keys(v).map(k => k + v[k]) + "}" : Object.is(v, -0) ? "-0" : typeof v === "function" ? "f" + v() : String(v));
function list(g, turns, mask) { const out = []; for (let k = 0; k < turns; k++) out.push(show(g(k & mask))); return out.join(); }
function counted(g, turns) { const out = []; for (let k = 0; k < turns; k++) out.push(show(g(k))); for (let k = 0; k < turns; k++) out.push(show(g(k))); return out.join(); }
const values = [x => x * x, x => ({ x }), x => "v" + x, x => undefined, x => null, x => x > 2, x => x / 4, x => -0, x => () => x, x => (x & 1 ? x : { x }), x => BigInt(x)];
const fill = { none: m => m, up: m => { for (let i = 0; i < 12; i++) m.set(i, "i" + i); return m; }, down: m => { for (let i = 11; i >= 0; i--) m.set(i, i); return m; }, names: m => { for (let i = 0; i < 5; i++) m.set("s" + i, { i }); return m; }, gaps: m => { for (let i = 0; i < 20; i++) m.set(i, i); for (let i = 0; i < 20; i += 2) m.delete(i); return m; }, objects: m => { for (let i = 0; i < 3; i++) m.set({ i }, i); return m; }, halves: m => { for (let i = 0; i < 6; i++) m.set(i / 2, i); return m; }, cleared: m => { for (let i = 0; i < 9; i++) m.set(i, i); m.clear(); return m; }, many: m => { for (let i = 0; i < 300; i++) m.set(i, i % 3 ? i : "t" + i); return m; }, zero: m => m.set(-0, "zero") };
for (const name in fill) for (const value of values) { const a = memo(value, fill[name](new Map())), b = changing(value, fill[name](new Map())); console.log(name, list(a, 24, 7), counted(a, 12), list(b, 40, 15), a.m.size, b.m.size); }
