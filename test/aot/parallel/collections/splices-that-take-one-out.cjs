// One element taken out by splice of lists of every kind, from every start, with every count; by a place that nobody proves anything of.
'use strict';
const out = [], hide = v => [v][JSON.parse('0')], o = {}, sym = Symbol('s');
const show = v => (v === undefined ? 'u' : v === o ? 'o' : typeof v === 'symbol' ? 'sym' : Object.is(v, -0) ? '-0' : typeof v === 'string' ? '"' + v + '"' : String(v));
const list = a => (a.constructor ? a.constructor.name : 'none') + a.length + '[' + Array.from({ length: Math.min(a.length, 70) }, (_, i) => (i in a ? show(a[i]) : '_')).join() + ']' + (Object.isFrozen(a) ? 'F' : Object.isSealed(a) ? 'S' : Object.isExtensible(a) ? '' : 'N');
const kinds = {
  none: () => [], one: () => [1], two: () => [1, 2], eight: () => [1, 2, 3, 4, 5, 6, 7, 8], long: () => Array.from({ length: 70 }, (_, i) => i), json: () => JSON.parse('[1,2,3]'), literal: () => [9, 8, 7], texts: () => ['a', 'b', 'c'], mixed: () => [1, 'b', o, null, undefined, sym, 2n, -0, 1.5], doubles: () => [1.5, 2.5, -0, 3.5], nan: () => [1.5, NaN, 2],
  hole: () => [1, , 3], holesAlone: () => new Array(4), holeAtEnd: () => { const a = [1, 2, 3]; a.length = 5; return a; }, deleted: () => { const a = [1, 2, 3]; delete a[1]; return a; }, popped: () => { const a = [1, 2, 3, 'x']; a.pop(); return a; }, far: () => { const a = [1, 2]; a[5000] = 3; return a; }, shifted: () => { const a = Array.from({ length: 40 }, (_, i) => i); for (let i = 0; i < 37; i++) a.shift(); return a; }, grown: () => { const a = []; for (let i = 0; i < 9; i++) a.push('g' + i); return a; },
  frozen: () => Object.freeze([1, 2, 3]), sealed: () => Object.seal([1, 2, 3]), closed: () => Object.preventExtensions([1, 2, 3]), sealedTexts: () => Object.seal(['a', 'b']), fixedLength: () => Object.defineProperty([1, 2, 3], 'length', { writable: false }), readOnly: () => Object.defineProperty([1, 2, 3], 1, { writable: false }), stuck: () => Object.defineProperty([1, 2, 3], 2, { configurable: false, value: 3 }), getter: () => Object.defineProperty([1, 2, 3], 1, { get() { return 'g'; }, configurable: true }), named: () => Object.assign([1, 2, 3], { x: 1 }),
  heir: () => new (class L extends Array {})(1, 2, 3), species: () => { const a = [1, 2, 3]; a.constructor = { [Symbol.species]: function () { return { length: 0, constructor: { name: 'made' } }; } }; return a; }, ownConstructor: () => Object.assign([1, 2, 3], { constructor: undefined }), noProto: () => Object.setPrototypeOf([1, 2, 3], Object.create(Array.prototype)), arrays: () => [[1], [2], [3]],
};
const starts = [0, 1, 2, -1, -2, -99, 3, 99, -0, 1.5, NaN, '1', null, undefined, true, { valueOf() { return 1; } }, 2147483648, Infinity], counts = [1, 0, 2, '1', 1.9, -1, undefined, null, true, NaN, Infinity];
const splice = (a, s, c) => a.splice(s, c);
function drop(a, s, c) { let k = 0; for (let i = 0; i < 3; i++) { a.splice(s, c); k += a.length; } return k; }
for (const [kn, kind] of Object.entries(kinds)) for (const s of starts) for (const c of counts) {
  let a = kind(); try { const r = hide(splice)(a, s, c); out.push(list(a) + '>' + (r.length === undefined ? 'x' : list(r)) + (Array.isArray(r) && Object.getPrototypeOf(r) === Array.prototype ? '' : 'p')); } catch (e) { out.push(kn + '!' + e.name + list(a)); }
  a = kind(); try { out.push(hide(drop)(a, s, c) + list(a)); } catch (e) { out.push(e.name + list(a)); }
}
for (const kind of [kinds.eight, kinds.grown]) { const a = kind(), r = hide(splice)(a, 3, 1); r.push('more'); r[5] = 1; a.push('behind'); a.unshift('front'); out.push(list(a), list(r)); }
const kept = []; for (let i = 0; i < 20000; i++) { const a = [{ i }, { i: -i }, { i: i * 2 }]; const r = hide(splice)(a, i % 3, 1); kept[i & 255] = r; if (a.length !== 2 || !r[0] || typeof a[0].i !== 'number' || typeof a[1].i !== 'number') out.push('LOST' + i); if (!(i & 4095)) globalThis.gc?.(); }
let sum = 0; for (const r of kept) sum += r[0].i; out.push(sum);
const between = Object.create(Array.prototype); between[1] = 'P'; for (const kind of [kinds.hole, kinds.two, kinds.one]) { const a = Object.setPrototypeOf(kind(), between); try { const r = hide(splice)(a, 0, 1); out.push(list(a) + '>' + list(r)); } catch (e) { out.push(e.name); } } delete between[1];
let h = 7; for (const x of out) { const t = String(x); for (let i = 0; i < t.length; i++) h = (Math.imul(h, 31) + t.charCodeAt(i)) | 0; } console.log(out.length, h, out.slice(0, 60).join('|'));
