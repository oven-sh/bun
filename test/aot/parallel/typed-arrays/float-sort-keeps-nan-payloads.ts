
let seed = 12345;
function next(): number { seed = (Math.imul(seed, 1103515245) + 12345) | 0; return seed; }
let hash = 0, calls = 0;
function note(x: any): void { const n = typeof x === "bigint" ? Number(x & 0xffffffn) : x; hash = (Math.imul(hash, 31) + (n | 0) + (n > 2147483647 ? 7 : 0)) | 0; }
const out: string[] = [];
function report(name: string, v: any): void { let h = 0; for (let i = 0; i < v.length; i++) { const x = v[i]; h = (Math.imul(h, 31) + (Number(x) | 0) + (Object.is(x, -0) ? 3 : 0)) | 0; } out.push(name + " " + v.length + " " + h + " calls " + calls + " " + hash); calls = 0; hash = 0; }
const lengths = [0, 1, 2, 3, 5, 7, 8, 9, 10, 16, 17, 63, 64, 65, 66, 73, 100, 127, 128, 129, 200, 257, 300, 700];
function fill(v: any, pattern: number): void {
  const big = typeof v[0] === "bigint";
  for (let i = 0; i < v.length; i++) {
    let x = pattern === 0 ? next() : pattern === 1 ? i : pattern === 2 ? v.length - i : pattern === 3 ? (i * 7) % 40 : pattern === 4 ? 5 : pattern === 5 ? (i < v.length / 2 ? i : v.length - i) : pattern === 6 ? next() & 3 : i < 20 ? i : 19 - i;
    v[i] = big ? BigInt(x) : x;
  }
}


function bytes(v: any): string { return Array.from(new Uint8Array(v.buffer, v.byteOffset, v.byteLength), x => x.toString(16)).join("").slice(0, 400); }
const specials = [NaN, -0, 0, Infinity, -Infinity, 1.5, -1.5, 5e-324, 1e300, 65504, 0.1];
for (const n of [1, 2, 3, 7, 8, 9, 20, 64, 65, 130]) for (const where of [-1, 0, 1, n >> 1, n - 1]) {
  const v = new Float64Array(n), w = new Float64Array(n), u = new Float64Array(n);
  for (let i = 0; i < n; i++) v[i] = specials[1 + (i * 7) % 10]! + (i % 3);
  if (where >= 0 && where < n) { const size = v.BYTES_PER_ELEMENT, raw = new Uint8Array(v.buffer, where * size, size); raw.fill(0xff); raw[0] = 0x17; raw[size - 1] = 0x7f; }
  w.set(v); u.set(v);
  let r: any = v.sort((a, b) => { calls++; note(a); note(b); return a - b; }); if (r !== v) out.push("other"); out.push(bytes(v)); report("up" + where, v);
  w.sort((a, b) => b - a); out.push(bytes(w)); report("down" + where, w);
  u.sort((a, b) => (Object.is(a, -0) ? -1 : 0) - (Object.is(b, -0) ? -1 : 0) || (a < b ? -1 : a > b ? 1 : 0)); out.push(bytes(u)); report("zeros" + where, u);
  const s = u.slice(); s.sort(); out.push(bytes(s)); const t = u.toSorted((a, b) => b - a); out.push(bytes(t));
}
for (const n of [4, 12, 100]) for (const at of [1, 3, 9]) for (const nan of [false, true]) {
  const make = (b: ArrayBuffer) => { const v = new Float64Array(b); fill(v, 0); for (let i = 0; i < v.length; i++) v[i] = v[i]! / 7; if (nan) v[2] = NaN; return v; };
  const z = new Float64Array(1).BYTES_PER_ELEMENT;
  const attempt = (name: string, f: () => any): void => { try { f(); out.push(name); } catch (e: any) { out.push(name + e.name + ": " + e.message); } };
  { const b = new ArrayBuffer(n * z, { maxByteLength: n * z * 2 }), v = make(b); let q = 0; attempt("shrink", () => v.sort((x, y) => { calls++; if (++q === at) b.resize(z * 2); return x - y; })); b.resize(n * z); report("shrunk", v); }
  { const b = new ArrayBuffer(n * z, { maxByteLength: n * z * 2 }), v = make(b); let q = 0; attempt("grow", () => v.sort((x, y) => { if (++q === at) b.resize(n * z * 2); return x - y; })); report("grown", v); }
  { const b = new ArrayBuffer(n * z), v = make(b); let q = 0; attempt("detach", () => v.sort((x, y) => { calls++; if (++q === at) v.buffer.transfer(); return x - y; })); report("detached", v); attempt("again", () => v.sort((x, y) => x - y)); attempt("default", () => v.sort()); }
  { const b = new ArrayBuffer(n * z), v = make(b); let q = 0; attempt("throw", () => v.sort((x, y) => { if (++q === at) throw new Error("thrown"); return x - y; })); report("thrown", v); }
  { const b = new ArrayBuffer(n * z), v = make(b); let q = 0; attempt("write", () => v.sort((x, y) => { if (++q === at) v.fill(1); return x - y; })); report("written", v); }
  { const v = new Float64Array(new SharedArrayBuffer(n * z)); fill(v, 0); if (nan) v[1] = NaN; attempt("shared", () => v.sort((x, y) => y - x)); report("shared", v); }
  { class F extends Float64Array { sort(f?: any): this { calls++; return super.sort(f); } toSorted(f?: any): any { out.push("toSorted"); return this.slice().sort(f); } } const v = new F(n); fill(v, 0); if (nan) v[0] = NaN; attempt("class", () => v.sort((x: number, y: number) => x - y)); report("class", v); attempt("bad", () => v.sort({} as any)); attempt("undefined", () => v.sort(undefined)); report("undefined", v); }
}
function optional(v: Float64Array, f?: (a: number, b: number) => number): any { return v.sort(f); }
for (const f of [undefined, (a: number, b: number) => b - a]) { const v = new Float64Array(30); fill(v, 0); v[4] = NaN; optional(v, f); report("optional", v); const w = new Float64Array(30); fill(w, 1); optional(w, f); report("optional", w); }
console.log(out.join("\n"));
