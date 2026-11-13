// Loops that only move elements between arrays or views about which nothing is known.
"use strict";
const n = 20, log = [], hidden = JSON.parse("[0]");
function hide(x) { hidden[0] = x; return hidden[0]; }
function list(f) { const a = []; for (let i = 0; i < n; i++) a.push(f(i)); return a; }
const ints = list(i => Math.imul(i + 3, 0x9e3779b9) | 0);
function changed(a, at, v) { const b = a.slice(); b[at] = v; return b; }
function detached() { const v = new Int32Array(n); structuredClone(v.buffer, { transfer: [v.buffer] }); return v; }
function resized(View, bytes) { const buffer = new ArrayBuffer(8 * n, { maxByteLength: 16 * n }), v = new View(buffer); for (let i = 0; i < v.length; i++) v[i] = i * 3; buffer.resize(bytes); return v; }
const makers = { ints: () => ints.slice(), halves: () => ints.map(x => x * .5), mixed: () => changed(ints, 3, "w"), hole: () => { const a = ints.slice(); delete a[4]; return a; }, frozen: () => Object.freeze(ints.slice()), short: () => [1, 2.5], empty: () => [], heir: () => class extends Array {}.from(ints), like: () => ({ 0: 4, 1: 2, length: 20 }), string: () => "abcdefghijklmnopqrst", none: () => null, proxy: () => new Proxy(new Int32Array(ints), {}), acting: () => changed(ints, 5, { valueOf() { log.push("value"); return 7; } }), big: () => changed(ints, 5, 5n), undefineds: () => changed(ints, 5, undefined), buffer: () => Buffer.from(ints), detached, shrunk: () => resized(Int32Array, 24), tracking: () => resized(Uint16Array, 12 * n), heirView: () => new (class extends Int32Array {})(ints), shared: () => new Int32Array(new SharedArrayBuffer(4 * n)), few: () => new Float64Array(3) };
for (const View of [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array]) makers[View.name] = () => new View(ints);
makers.nans = () => new Float64Array(new BigUint64Array([0x7ff8000000000001n, 0xfff8000000000000n, 0x7ff0000000000001n, 0x8000000000000000n]).buffer);
makers.BigInt64Array = () => new BigInt64Array(n);
const moves = {
  copy(a, b) { for (let i = 0; i < n; i++) b[i] = a[i]; },
  copyBack(a, b) { for (let i = n - 1; i >= 0; i--) b[i] = a[i]; },
  copyLength(a, b) { for (let i = 0; i < a.length; i++) b[i] = a[i]; },
  shift(a, b) { for (let i = 0; i + 1 < n; i++) b[i] = a[i + 1]; },
  shiftUp(a, b) { for (let i = 1; i < n; i++) b[i] = a[i - 1]; },
  swap(a) { for (let i = 0; i < n; i++) { const q = a[i]; a[i] = a[n - 1 - i]; a[n - 1 - i] = q; } },
  exchange(a, b) { for (let i = 0; i < n; i++) { const q = a[i]; a[i] = b[i]; b[i] = q; } },
  reverse(a) { for (let i = 0, j = n - 1; i < j; i++, j--) { const q = a[i]; a[i] = a[j]; a[j] = q; } },
  rotate(a) { const first = a[0]; for (let i = 0; i < n - 1; i++) a[i] = a[i + 1]; a[n - 1] = first; },
  past(a, b) { for (let i = 0; i < n + 3; i++) b[i] = a[i]; },
  nested(a, b) { for (let o = 0; o < 2; o++) for (let i = 0; i < n; i++) b[i] = a[i]; },
  some(a, b) { for (let i = 0; i < n; i++) if (i & 1) b[i] = a[i]; },
};
function show(v) { return v === null || typeof v !== "object" ? Object.is(v, -0) ? "-0" : typeof v + String(v) : "["; }
function dump(b) { if (b === null || typeof b !== "object") return String(b); let t = ""; try { t = b.length + ":"; for (let i = 0; i < n + 4; i++) t += (i in b ? show(b[i]) : "_") + ","; } catch (error) { t = error.name; } return t; }
function sumOf(text) { let s = 0; for (let i = 0; i < text.length; i++) s = Math.imul(s, 31) + text.charCodeAt(i) | 0; return s; }
for (const name in moves) {
  const move = hide(moves[name]);
  for (const first in makers) {
    const lines = [];
    for (const second in makers) {
      const a = hide(makers[first]()), b = hide(makers[second]());
      let answer = "";
      try { move(a, b); } catch (error) { answer = "threw " + error.name; }
      lines.push(sumOf(answer + dump(a) + dump(b) + log.splice(0).join()));
    }
    const own = hide(makers[first]());
    try { move(own, own); } catch (error) { lines.push(error.name); }
    lines.push(sumOf(dump(own)));
    console.log(name, first, lines.join(" "));
  }
  for (const View of [Int8Array, Int16Array, Int32Array, Float32Array, Float64Array]) for (const Other of [Uint8Array, Int32Array, View]) for (const offset of [0, 8, 16, 24]) {
    const bytes = new ArrayBuffer(8 * n + 64);
    new Uint8Array(bytes).forEach((_, i, all) => { all[i] = i * 7 % 120; });
    const a = hide(new View(bytes, 0, n)), b = hide(new Other(bytes, offset, n));
    move(a, b);
    move(b, a);
    console.log(name, View.name, Other.name, offset, sumOf(new Uint8Array(bytes).join()));
  }
}
