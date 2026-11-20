// elements-outside-a-view-among-numbers.ts
const v = new Float64Array([1.5, NaN, -0, Infinity]); const w = new Float64Array(8), u = new Uint32Array(4), odd = new Float64Array(new BigUint64Array([0x7ff8000000000001n, 0xfff8dead0000beefn, 0x7ff0000000000001n]).buffer);
function sum(l: Float64Array, n: number, step: number): number { let s = 0; for (let i = 0; i < n; i++) s += l[i * step]! * 2; return s; }
function copy(a: Float64Array, b: Float64Array, n: number, k: number): string { for (let i = 0; i < n; i++) b[i * k] = a[i * k]! + 1; return Array.from(b).map(x => Object.is(x, -0) ? "-0" : String(x)).join(); }
function both(l: Float64Array, i: number): string { const x = l[i * 2]; const y = x! + 1; return String(x) + "/" + y + "/" + (x === undefined) + "/" + typeof x; }
function plus(l: Float64Array, i: number): string { const x = +l[i * 3]!; return String(x) + (x !== x); }
function bits(l: Float64Array, i: number): number { return (l[i * 5]! | 0) + (l[i * 5]! >>> 0) + (l[i * 5]! < 1 ? 1 : 2) + (l[i * 5]! >= 0 ? 4 : 8); }
function maybe(l: Float64Array, i: number, c: boolean): string { const x = c ? l[i * 7] : undefined; return String(x) + String((x as number) * 1); }
(globalThis as any).all = [sum, copy, both, plus, bits, maybe];
for (let t = 0; t < 3; t++) {
  console.log(sum(v, 1, 1), sum(v, 2, 1), sum(v, 3, 2), sum(v, 9, 3), sum(odd, 3, 1), copy(v, w, 3, 2), copy(odd, w, 4, 1));
  console.log(both(v, 0), both(v, 1), both(v, 9), both(odd, 0), plus(v, 0), plus(v, 1), plus(v, 9), plus(odd, 0), bits(v, 0), bits(v, 1), bits(odd, 0), maybe(v, 0, true), maybe(v, 1, true), maybe(v, 1, false));
  u[0] = v[t * 9]!; u[1] = v[1]!; w[7] = v[t + 9]!; console.log(u.join(), Object.is(w[7], NaN), String([v[t + 4]]), JSON.stringify({ a: v[t + 4], b: v[1] }), Math.max(v[t + 4]! , 1), (v[t + 4] ?? "nothing"));
}
const r = new Float64Array(new ArrayBuffer(32, { maxByteLength: 64 })); r.fill(2); for (let i = 0; i < 6; i++) { console.log(sum(r, i + 1, 1)); if (i === 2) (r.buffer as any).resize(16); } export {};
