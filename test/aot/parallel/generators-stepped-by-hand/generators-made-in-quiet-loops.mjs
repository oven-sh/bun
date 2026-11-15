let G = 0, cap = 1, o = { v: 2 }, l = [3, 4];
function boom(n) { G += 5; if (n === 2) throw new Error('boom'); return n; }
function show(v) { return v === null ? 'null' : typeof v === 'object' ? (Array.isArray(v) ? '[' + v.map(show).join() + ']' : '{' + Object.keys(v).map(k => k + ':' + show(v[k])).join() + '}') : typeof v === 'function' ? 'fn' : typeof v === 'string' ? JSON.stringify(v) : String(v); }
function* gen(o2) { throw new Error('b' + G); }
function f(n, m) { let s = '', c = 0, P0 = null; const keep = [], t = new Set(); for (let i = 0; i < m; i++) { const it = gen(o); o = { v: 61 }; if (i === 1) s += show(it.next()); } return [s, c, keep.map((k) => show(k.next?.())).join('/'), t.size, G, show(cap), show(o), show(l)]; }
for (let z = 0; z < 2; z++) for (const n of [0, 1, 2]) for (const m of [1, 4]) { G = 0; cap = 1; o = { v: 2 }; l = [3, 4]; let y; try { y = f(n, m); } catch (e) { y = 'T' + e?.message; } console.log(n, m, String(y), G); }
export {};
