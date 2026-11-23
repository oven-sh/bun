// Values are told apart by typeof and by tests for objects, for functions and for numbers that equal themselves as integers; the ways behind the tests meet again, in switches, conditions and turns.
function kind(v) { switch (typeof v) { case 'object': if (!v) return 1; case 'function': return v.code ? v.code() : 2; case 'number': return (v | 0) === v ? v : 3; case 'string': return v.length; default: return 4; } }
function either(v, w) { const a = typeof v === 'object' || typeof v === 'function', b = typeof w === 'object' && w !== null; return (a && b ? v === w : a !== b) + '/' + (a ? 'a' : 'p') + (b ? 'b' : 'q'); }
function whole(v) { return v == (v | 0) ? 'w' + v : v === v ? 'n' : 'nan'; }
function meet(v) { let s = 0; if (typeof v === 'function') s = 1; else if (typeof v === 'object') { if (v === null) return 'null'; s = 2; } else s = 3; if (s < 3) s += 'size' in v ? 10 : 20; else s += v === undefined ? 30 : 40; return s; }
function over(list) { let s = ''; for (let i = 0; i < list.length; i++) { const v = list[i]; if (typeof v !== 'object' && typeof v !== 'function' || v === null) { s += typeof v === 'number' && v == (v | 0) ? 'i' : 'p'; continue; } s += typeof v === 'function' ? 'f' : Array.isArray(v) ? 'l' : 'o'; } return s; }
const say = f => { try { return String(f()); } catch (e) { return e.constructor.name; } };
const callable = Object.assign(function () {}, { size: 1, code: () => 77 });
const values = [0, -0, 1, 2.5, NaN, 2147483648, -2147483648, Infinity, '', 'text', true, false, null, undefined, Symbol.match, 10n, {}, { code() { return 9; }, size: 2 }, [], [1, 2], () => 1, callable, class {}, new Proxy({}, {}), new Proxy(function () {}, {}), new Number(3), Object.create(null), /x/, new Date(0)];
for (let k = 0; k < 60; k++) { for (const v of [1, 'two', {}, 3, values[21]]) { kind(v); meet(v); either(v, 4); } over(values.slice(0, 13)); }
for (const v of values) console.log(say(() => kind(v)), say(() => either(v, {})), say(() => either(v, v)), say(() => whole(v)), say(() => meet(v)), over([v, 1, v]));
console.log(over(values), over(values.slice().reverse()), whole('7'), whole([4]), whole({ valueOf: () => 8 }), say(() => whole(1n)));
