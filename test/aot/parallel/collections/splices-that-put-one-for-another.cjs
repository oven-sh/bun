'use strict';
// One element put for another by splice, in lists and with items of every kind.
const out = [], hide = v => [v][JSON.parse('0')], o = { v: 1 }, put = (a, s, c, x) => a.splice(s, c, x);
const show = v => (v === o ? 'o' : typeof v === 'symbol' ? 'sym' : Object.is(v, -0) ? '-0' : typeof v === 'string' ? '"' + v + '"' : String(v));
const list = a => a.length + '[' + Array.from({ length: a.length }, (_, i) => (i in a ? show(a[i]) : '_')).join() + ']';
const kinds = { ints: () => JSON.parse('[1,2,3,4]'), one: () => JSON.parse('[1]'), none: () => [], texts: () => JSON.parse('["a","b","c"]'), mixed: () => JSON.parse('[1,"b",null]'), doubles: () => [1.5, 2.5], literal: () => [9, 8, 7], hole: () => [1, , 3], frozen: () => Object.freeze([1, 2, 3]), sealed: () => Object.seal([1, 2, 3]), closed: () => Object.preventExtensions([1, 2]), readOnly: () => Object.defineProperty([1, 2, 3], 1, { writable: false }), fixed: () => Object.defineProperty([1, 2], 'length', { writable: false }), heir: () => new (class L extends Array {})(1, 2, 3), long: () => Array.from({ length: 70 }, (_, i) => i) };
const items = [7, 1.5, -0, NaN, 2147483648, 't', o, null, undefined, true, 3n, Symbol('q')];
for (const kind of Object.values(kinds)) for (const x of items) for (const s of [0, 1, 2, -1, -9, 9, 1.5, '1', undefined]) for (const c of [1, 0, 2, '1', undefined]) {
  const a = kind(); try { const r = hide(put)(a, s, c, x); out.push(list(a) + '>' + list(r) + (Object.getPrototypeOf(r) === Array.prototype ? '' : 'p')); } catch (e) { out.push(e.name + list(a)); }
}
for (let i = 0; i < 3; i++) { const a = [9, 8, 7]; hide(put)(a, i, 1, 5); out.push(list(a), list([9, 8, 7])); const r = hide(put)(a, 0, 1, 'x'); r.push(1.5); r.unshift('y'); out.push(list(r), list(a)); }
const above = Object.create(Array.prototype, { 1: { value: 'P', configurable: true } }); for (let s = 0; s < 3; s++) { const a = Object.setPrototypeOf([1, , 3], above); try { out.push(list(hide(put)(a, s, 1, 5)) + list(a)); } catch (e) { out.push(e.name); } }
const ring = Array.from({ length: 8 }, (_, i) => ({ i })), kept = []; let lost = 0;
for (let i = 8; i < 60000; i++) { const r = hide(put)(ring, i & 7, 1, { i }); kept[i & 255] = r; if (r.length !== 1 || r[0].i !== i - 8 || ring[i & 7].i !== i) lost++; }
out.push(lost, kept.reduce((s, r) => (s + r[0].i) % 100003, 0));
let h = 7; for (const x of out) { const t = String(x); for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0; } console.log(out.length, h, out.slice(0, 50).join('|'));
