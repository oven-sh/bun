// What is converted, or cannot be, goes into clamped views, views of integers, of big integers and of half floats through a function that knows nothing; positions outside, negative, fractional, texts; detached and resized views.
'use strict';
const z = JSON.parse('0'), any = x => [x][z], put = (v, i, x) => { v[i] = x; }, out = [];
for (const C of [Uint8ClampedArray, Uint8Array, Int16Array, BigInt64Array, Float16Array ?? Float32Array]) { const v = new C(4); for (const x of [1.5, true, null, undefined, '7.5', 'x', { valueOf() { return 2.5; } }, 3n, Symbol.iterator]) { try { put(any(v), any(1), any(x)); out.push(String(v[1])); } catch (e) { out.push(e.name[0]); } } for (const i of [4, -1, 0.5, '1', '-0']) { try { put(any(v), any(i), any(9.5)); } catch (e) { out.push(e.name[0]); } } out.push(v.join('/')); }
const d = new Uint8ClampedArray(2), r = new ArrayBuffer(4, { maxByteLength: 8 }), w = new Uint8ClampedArray(r); structuredClone(d.buffer, { transfer: [d.buffer] }); put(any(d), any(0), any(1.5)); put(any(w), any(3), any(254.5)); r.resize(2); put(any(w), any(3), any(9.5)); r.resize(6); out.push(d.length, w.join('/'));
console.log(out.join());
