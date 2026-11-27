// Every pair out of 21 values of every kind goes through sums, sums of products, steps and comparisons: what comes, or which error, is printed by its kind.
const V = [1, 2.5, -0, NaN, 3n, 0n, '5', 'x', '', true, null, undefined, [6], { valueOf: () => 7 }, { valueOf: () => 8n }, { toString: () => '9' }, Symbol('s'), new Date(0), Object(2n), new String('4'), () => 1];
const w = v => typeof v === 'symbol' ? 'sym' : Object.is(v, -0) ? '-0' : typeof v + ':' + String(v).slice(0, 12);
const t = f => { try { return w(f()); } catch (e) { return e.name; } };
for (const a of V) { let s = ''; for (const b of V) s += t(() => a + b) + ' '; console.log(s); }
{ for (const a of V) { let s = ''; for (const b of V) s += t(() => a * a + b * b) + ' ' + t(() => (a - b) + (b - a)) + ' '; console.log(s); } }
{ for (const a of V) { let s = ''; for (const b of V) s += t(() => { let x = a + 1; x++; return x; }) + ' ' + t(() => (a + 1) + (b + 1)) + ' ' + t(() => (a + '') - (b + '')) + ' '; console.log(s); } }
{ const steps = [x => { x++; return x; }, x => x++, x => -x, x => ~x, x => +x, x => x - 1, x => x * 2, x => x / 2, x => x % 2, x => x ** 2, x => x & 1, x => x | 0, x => x ^ 1, x => x << 1, x => x >> 1, x => x >>> 0]; for (const a of V) console.log(steps.map(f => t(() => f(a))).join(' '), '|', steps.map(f => t(() => f(a + 1))).join(' ')); }
{ class W { constructor(p) { this.pos = p; } add(x) { this.pos += x; this.pos++; this.pos -= 1; return this.pos; } } for (const p of V) for (const x of V) console.log(t(() => new W(p).add(x))); }
{ const d = (a, b) => { const x = a - b, y = a * b; return x * x + y * y; }; for (const a of V) { let s = ''; for (const b of V) s += t(() => { const r = d(a, b); return (r < 5) + '/' + (r > 2n) + '/' + (r === 5) + '/' + `${r}`.slice(0, 6) + '/' + (r ? 1 : 0); }) + ' '; console.log(s); } }
{ function g(x) { switch (x * x + x) { case 2: return 'two'; case 6n: return 'six'; case '5': return 'text'; default: return typeof (x * x + x); } } for (const a of V) console.log(t(() => g(a)), t(() => (a * a + a) in { 2: 1 }), t(() => [7, 8, 9][a * a + 0]), t(() => Math.max(a * a + a * a, 0)), t(() => JSON.stringify(a * a + a))); }
