// A generator copied into its caller leaves its loop where the counter meets a bound; the branch is walked once behind a guess on the object that the loop makes anew, and once behind the arm that runs other code.
const lines = [], keep = []; const show = v => v === undefined ? 'u' : Object.is(v, -0) ? '-0' : Array.isArray(v) ? '[' + Array.from(v, show).join() + ']' : typeof v === 'object' && v ? '{' + Object.keys(v).map(k => k + ':' + show(v[k])).join() + '}' : typeof v === 'function' ? 'fn' : String(v);
class V { constructor(x, y) { this.x = x; this.y = y; } add(o) { return new V(this.x + o.x, this.y + o.y); } }
const boom = q => { if (q) throw new RangeError('b'); return q; }, pass = q => q, note = q => { lines.push(show(q)); };
const L = [0, 1, 2, 3], waits = []; function go(f) { try { note(f()); } catch (e) { lines.push('T' + e.name); } }
function* f9(a, n) { let p = { x: a, y: a }, s = 0, q0, f; let i = 0; do { p = { x: p.y, y: p.x + p.y }; if (i === 4) break; i++; } while (i < n); keep.push(p);  return [p, s]; }
for (let turn = 0; turn < 2; turn++) {
go(() => { const out = []; const it = f9(0, 5); let z; do { z = it.next(); out.push(z.value); } while (!z.done); return out; });
go(() => { const out = []; const it = f9(1, 5); let z; do { z = it.next(); out.push(z.value); } while (!z.done); return out; });
go(() => { const out = []; const it = f9(2, 3); let z; do { z = it.next(); out.push(z.value); } while (!z.done); return out; });
go(() => { const out = []; const it = f9(0, 0); let z; do { z = it.next(); out.push(z.value); } while (!z.done); return out; });
go(() => { const out = []; const it = f9(0.5, 8); let z; do { z = it.next(); out.push(z.value); } while (!z.done); return out; });
note(keep.length); }
Promise.all(waits).then(() => { note(keep.slice(-9)); console.log(lines.join('\n')); });
