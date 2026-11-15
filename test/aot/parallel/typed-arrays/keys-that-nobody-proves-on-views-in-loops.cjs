// Views in sight read, stored and updated in loops under keys of every kind that nobody proves.
'use strict';
const out = [], hide = v => [v][JSON.parse('0')], sym = Symbol('s');
let log = '';
const show = v => typeof v + ':' + (Object.is(v, -0) ? '-0' : typeof v === 'function' ? v.name : String(v));
const keys = [0, 1, 3, 4, 7, -1, -0, 1.5, NaN, Infinity, 2147483647, 2147483648, -2147483648, 4294967295, '0', '3', '4', '-0', '1.5', '01', 'length', 'byteLength', 'x', '', null, undefined, true, 2n, -1n, sym, Symbol.iterator, [1], { toString() { log += 't'; return '2'; } }, { valueOf() { log += 'v'; return 1; }, toString() { return '3'; } }, { toString() { throw new RangeError('k'); } }];
const makes = [() => new Uint8Array(4), () => new Int8Array(4), () => new Uint8ClampedArray(4), () => new Uint16Array(4), () => new Int32Array(4), () => new Uint32Array(4), () => new Float32Array(4), () => new Float64Array(4)];
const U8 = new Uint8Array(4), I32 = new Int32Array(4), U32 = new Uint32Array(4), F64 = new Float64Array(4), U8C = new Uint8ClampedArray(4), B64 = new BigInt64Array(4);
function reads(ks) { let r = ''; U8.set([7, 8, 9, 10]); F64.set([.5, -0, NaN, 3]); B64.set([1n, 2n, 3n, 4n]); for (let i = 0; i < ks.length; i++) { const k = ks[i]; r += show(U8[k]) + show(F64[k]) + show(B64[k]) + (U8[k] ? 'y' : 'n') + ';'; } return r; }
function stores(ks, v) { for (let i = 0; i < ks.length; i++) { const k = ks[i]; U8[k] = v; I32[k] = v; F64[k] = v; U8C[k] = v; } return [U8, I32, F64, U8C].map(a => Array.from(a, show).join() + Reflect.ownKeys(a).length).join('|'); }
function updates(ks) { for (let i = 0; i < ks.length; i++) { const k = ks[i]; U32[k]++; U8[k] += 3; I32[k] |= 4; --F64[k]; U8C[k] -= 1; } return [U32, U8, I32, F64, U8C].map(a => Array.from(a, show).join()).join('|'); }
function selfs(ks) { let r = ''; for (let i = 0; i < ks.length; i++) { const k = ks[i]; r += show(I32[k] = k) + ';'; } return r + I32.join(); }
function strict(ks) { let r = ''; for (const k of ks) { try { U8[k] = 1; r += 's'; } catch (e) { r += e.name; } try { r += show(U8[k]); } catch (e) { r += e.name; } } return r; }
function keyed(ks) { const seen = new Uint8Array(8); let n = 0; for (const k of ks) { if (!seen[k]) n++; seen[k] = 1; } return n + ':' + seen.join(''); }
const clean = () => { for (const a of [U8, I32, U32, F64, U8C]) { a.fill(0); for (const k of Reflect.ownKeys(a)) if (typeof k === 'symbol' || isNaN(k)) delete a[k]; } for (const a of [U8, I32, U32, F64, U8C]) for (const k of ['1.5', '01', '-0']) delete a[k]; B64.fill(0n); };
const t = f => { clean(); log = ''; try { out.push(f() + log); } catch (e) { out.push(e.name + log); } };
for (let r = 0; r < 6; r++) { hide(reads)([0, 1, 2, 3]); hide(stores)([0, 1], 5); hide(updates)([0, 1, 2]); }
for (const k of keys) { t(() => hide(reads)([0, k, 1])); t(() => hide(updates)([1, k, 2])); t(() => hide(selfs)([2, k, 3])); t(() => hide(strict)([k, 0])); t(() => hide(keyed)([1, k, 2, k, 1])); for (const v of [1, -1, 300, 1.5, -0, NaN, '12', 'x', null, undefined, true, { valueOf() { log += 'V'; return 6; } }, 3n]) t(() => hide(stores)([0, k], v)); }
t(() => hide(reads)(keys.filter(k => typeof k !== 'object' || Array.isArray(k) || k === null))); t(() => hide(keyed)(JSON.parse('[0,1,2,7,8,-1,1.5,3,3,"4","x",null]')));
for (const make of makes) { const a = make(); const f = (ks, v) => { let s = ''; for (let i = 0; i < ks.length; i++) { v[ks[i]] = i + .75; s += show(v[ks[i]]) + ','; } return s; }; t(() => hide(f)([0, 1, '2', 3, 4, -1], a) + a.join()); }
let grow = new Uint8Array(new ArrayBuffer(4, { maxByteLength: 16 })); const g = ks => { let s = ''; for (let i = 0; i < ks.length; i++) { if (i === 2) grow.buffer.resize(2); if (i === 4) grow.buffer.resize(16); s += show(grow[ks[i]]) + ','; grow[ks[i]] = i; } return s; }; t(() => hide(g)([0, 1, 3, 3, 3, 15, 16, '1']));
const gone = new Uint8Array(4); const h = ks => { let s = ''; for (let i = 0; i < ks.length; i++) { if (i === 1) structuredClone(gone.buffer, { transfer: [gone.buffer] }); gone[ks[i]] = 9; s += show(gone[ks[i]]); } return s; }; t(() => hide(h)([0, 0, 1, '0']));
let hash = 7; for (const x of out) { const s = String(x); for (let i = 0; i < s.length; i++) hash = (Math.imul(hash, 31) + s.charCodeAt(i)) | 0; } console.log(out.length, hash, out.slice(0, 30).join('|').slice(0, 3000));
