// Loops that move elements between unknown holders: every pair of views of one buffer, buffers that are resized and detached, every pair of arrays.
const log = []; const K = [Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, Buffer];
const of = (C, b, at, n) => C === Buffer ? Buffer.from(b, at, n) : new C(b, at, n);
let sum = 0; const add = x => { sum = (Math.imul(sum, 31) + x) | 0; }; const addBytes = b => { if (b.detached) return add(-7); for (const x of new Uint8Array(b)) add(x); };
const hold = JSON.parse('{"d":0,"s":0}'); let D, S, N = 0, B;
function fill(b) { const v = new Uint8Array(b); for (let i = 0; i < v.length; i++) v[i] = i * 37 + 11 & 255; }
function turn(name, run, d, s, n, b) { hold.d = d; hold.s = s; D = d; S = s; B = b; let r; try { r = run(hold, d, s, n); } catch (e) { r = e.constructor.name; } if (b) addBytes(b); else { for (const x of d) add(typeof x === "number" ? x * 8 | 0 : x === undefined ? 3 : String(x).length); add(d.length); } add(typeof r === "number" ? r : 5); }
const runs = {
  shifted(m, d, s, n) { for (let i = 0; i < n; i++) d[i + 1] = s[i]; return 0; },
  withinDown(m, d, s, n) { for (let i = n; i > 1; i--) s[i] = s[i - 2]; return 0; },
  variable(m, d, s, n) { N = 0; for (let i = 0; i < n; i++) d[N++] = s[i]; return N; },
  swap(m, d, s, n) { for (let i = 0; i < n; i++) { const q = s[i]; s[i] = s[n - 1 - i]; s[n - 1 - i] = q; } return 0; },
  swapTwo(m, d, s, n) { for (let i = 0; i < n; i++) { const q = d[i]; d[i] = s[i]; s[i] = q; } return 0; },
  swapFields(m, d, s, n) { for (let i = 0; i < n; i++) { const q = m.d[i]; m.d[i] = m.s[i]; m.s[i] = q; } return 0; },
  twice(m, d, s, n) { for (let i = 0; i < n; i++) { const v = s[i]; d[i] = v; d[n - i] = v; } return 0; },
  gather(m, d, s, n) { const t = [3, 1, 0, 2]; for (let i = 0; i < n; i++) d[i] = s[t[i & 3]]; return 0; },
  resizes(m, d, s, n) { for (let i = 0; i < n; i++) { d[i] = s[i]; if (i === 3 && B && B.resizable) B.resize(16); } return 0; },
  exchanged(m, d, s, n) { for (let i = 0; i < n; i++) { m.d[i] = m.s[i]; if (i === 3) m.d = s; } return 0; }
};
for (const [form, run] of Object.entries(runs)) { log.push(form);
for (const C of K) for (const E of K) { sum = 0; for (const [p, q] of [[0, 0], [0, 8], [8, 0], [16, 8], [0, 64]]) for (const n of [12, 5, 3, 20]) { const b = new ArrayBuffer(256); fill(b); turn("v", run, of(C, b, p, 14), of(E, b, q, 14), n, b); } log.push(C.name + E.name + sum); }
for (const C of K) for (const E of K) { if (C === Buffer || E === Buffer) continue; sum = 0; for (const m of [40, 24, 8, 96]) { const b = new ArrayBuffer(64, { maxByteLength: 128 }); fill(b); const d = new C(b), s = new E(b, 8); b.resize(m); turn("r", run, d, s, 10, b); b.resize(120); turn("r", run, d, s, 10, b); } log.push("resized" + C.name + E.name + sum); }
for (const C of K) { sum = 0; const b = new ArrayBuffer(128); fill(b); const d = of(C, b, 0, 12), s = of(C, b, 8, 12); turn("g", run, d, s, 9, b); structuredClone(b, { transfer: [b] }); turn("g", run, d, s, 9, b); log.push("gone" + C.name + sum); }
const A = { ints: () => [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], doubles: () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5, 9.5], boxed: () => ["a", 2, {}, 4.5, null, undefined, 7, "h", 9], holes: () => [1, , 3, 4.5, , 6, 7, 8], dholes: () => [1.5, , 3.5, 4.5, , 6.5, 7.5], empty: () => [], room: () => { const a = [1, 2, 3, 4, 5, 6]; a.length = 4; return a; }, late: () => { const a = [1, 2, 3, 4, 5, 6, 7, 8]; a[6] = "x"; return a; }, mixed: () => [1, 2.5, 3, 4.5, 5, 6, 7, 8], cow: () => [1, 2, 3, 4, 5], frozen: () => Object.freeze([1, 2, 3, 4, 5, 6, 7]), text: () => ["a", "b", "c", "d", "e", "f"], sparse: () => { const a = [1, 2, 3]; a[900] = 5; a.length = 12; return a; }, getter: () => { const a = [1, 2, 3, 4, 5, 6, 7, 8]; Object.defineProperty(a, 3, { get() { add(9); return 33; }, set(v) { add(11); } }); return a; } };
for (const t in A) for (const u in A) { sum = 0; for (const n of [8, 5, 4, 2, 11]) { turn("a", run, A[t](), A[u](), n); const one = A[t](); turn("a", run, one, one, n); } log.push(t + u + sum); }
for (const t in A) for (const C of K) { sum = 0; for (const n of [8, 5, 11]) { const b = new ArrayBuffer(128); fill(b); turn("m", run, A[t](), of(C, b, 8, 9), n); turn("m", run, of(C, b, 8, 9), A[t](), n, b); } log.push(t + C.name + sum); }
}
console.log(log.join("\n"));
