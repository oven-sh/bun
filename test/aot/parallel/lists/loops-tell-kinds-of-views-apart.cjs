// A loop over views of several kinds has a version for each kind.
"use strict";
function list() {
  const a = [];
  for (let i = 0; i < 40; i++) a.push((i * 37) % 251);
  return a;
}
function sum(view) {
  let s = 0;
  for (let i = 0; i < view.length; i++) s += view[i];
  return s;
}
function mix(view, t) {
  for (let i = 0; i < view.length; i++) view[i] = (view[i] ^ t) * 3;
  return view[7];
}
function shift(view, other) {
  let s = 0;
  for (let i = 0; i < view.length; i++) {
    view[i] = other[i] - view[i + 1];
    s += view[i] >>> 1;
  }
  return s;
}
const makers = [() => new Uint8Array(list()), () => new Int32Array(list()), () => new Uint32Array(list()), () => new Float64Array(list())];
const a = makers.map(make => make()), b = makers.map(make => make());
for (let t = 0; t < 9; t++) {
  for (let i = 0; i < a.length; i++) console.log(sum(a[i]), mix(b[i], t), shift(a[i], b[(i + t) & 3]));
}
const tracked = new Uint8Array(new ArrayBuffer(16, { maxByteLength: 64 }));
console.log(sum(tracked), mix(tracked, 5));
tracked.buffer.resize(40);
console.log(sum(tracked), mix(tracked, 6), shift(tracked, a[2]));
const moved = new Float64Array(list());
structuredClone(moved.buffer, { transfer: [moved.buffer] });
console.log(sum(moved), mix(moved, 7), shift(moved, a[1]), shift(a[1], moved));
for (const other of [new BigInt64Array(3), [1, 2.5, , "4"], { length: 3, 0: 1, 1: 2 }, "abc", new Float32Array(list()), new Uint8ClampedArray(list())]) {
  for (const f of [sum, mix, shift]) {
    try {
      console.log(String(f(other, f === shift ? a[0] : 2)));
    } catch (e) {
      console.log(e.constructor.name);
    }
  }
}
for (const view of a.concat(b)) console.log(Array.from(view).join());
