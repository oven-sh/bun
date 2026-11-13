const show = v => Object.is(v, -0) ? '-0' : typeof v === 'object' && v ? JSON.stringify(v) : typeof v === 'bigint' ? v + 'n' : typeof v === 'symbol' ? 'sym' : typeof v === 'function' ? 'fn' : String(v);
const lines = [];
const say = (...a) => { lines.push(a.map(show).join(' ')); };
const tried = f => { try { return f(); } catch (e) { return e.constructor.name + ': ' + e.message; } };
class One { constructor(v) { this.a = v; } }
class Two { constructor(v) { this.b = 0; this.a = v; } }
class Derived extends Two { constructor(v) { super(v); this.c = 1; } }
const values = [undefined, null, false, true, 0, -0, NaN, 1, -1, 0.5, 2147483647, 2147483648, -2147483649, 1e300, Infinity, '', 'a', 'ab', 'a' + String.fromCharCode(98), ('x' + 'y').repeat(3), 'caf\u00e9', '\u4e00', 0n, 1n, -1n, 2n ** 70n, Symbol.iterator, {}, [], [1], function () {}, () => 1, new Map(), /x/, new Date(0), Object(false), Object(''), Object.create(null)];
const makers = [v => ({ a: v, b: 1 }), v => ({ b: 1, a: v }), v => ({ c0: 0, c1: 1, c2: 2, c3: 3, c4: 4, c5: 5, c6: 6, c7: 7, c8: 8, c9: 9, a: v }), v => { const o = JSON.parse('{"a":1,"z":2}'); o.a = v; return o; }, v => { const o = {}; o.x = 1; o.a = v; return o; }, v => { const o = {}; for (let i = 0; i < 70; i++) o['k' + i] = i; o.a = v; return o; }, v => Object.create({ a: v }), v => Object.create(Object.create({ a: v })), v => ({ get a() { return v; } }), v => new (class { get a() { return v; } })(), v => new One(v), v => new Two(v), v => new Derived(v), v => Object.assign(function () {}, { a: v }), v => Object.assign([1, 2], { a: v }), v => Object.assign(new Map(), { a: v }), v => Object.assign(Object.create(null), { a: v }), v => Object.freeze({ a: v }), v => Object.defineProperty({}, 'a', { value: v }), v => new Proxy({ a: v }, {}), v => { const o = { a: 1, b: 2 }; delete o.a; return o; }, v => ({ b: 1 }), v => Object.assign(/x/, { a: v }), v => Object.assign(new Date(0), { a: v }), v => Object.assign(new Error('e'), { a: v })];
const reads = [o => show(o.a), o => (() => { if (o.a) return 't'; return 'f'; })(), o => show(!o.a), o => show(o.a && 'y'), o => show(o.a || 'n'), o => (o.a ? 't' : 'f'), o => show(o.a ?? 'n'), o => show(o?.a), o => (() => { let k = 0; while (o.a) { if (++k > 2) break; } return 'k' + k; })(), o => (o.a && o.b ? 't' : 'f'), o => show(Boolean(o.a)), o => show(!!o.a), o => typeof o.a, o => show(o.a === o.a)];
for (let round = 0; round < 3; round++) for (let m = 0; m < makers.length; m++) for (let u = 0; u < reads.length; u++) { let text = ''; for (const v of values) text += reads[u](makers[m](v)) + ','; say(m, u, text); }
function truth(o) { if (o.a) return 1; return 0; }
function value(o) { return o.a; }
for (let m = 0; m < makers.length; m++) { let text = ''; for (let i = 0; i < 4 * values.length; i++) { const o = makers[i & 1 ? m : 0](values[i % values.length]); text += truth(o) + show(value(o)); } say(m, text); }
console.log(lines.join('\n'));
