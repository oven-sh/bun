
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

function attempt(name: string, f: () => any): void { try { const r = f(); out.push(name + " " + (r === undefined ? "undefined" : ArrayBuffer.isView(r) ? "view " + (r as any).length : String(r))); } catch (e: any) { out.push(name + " " + e.name + ": " + e.message); } }
for (const n of [4, 12, 100]) for (const at of [1, 3, 9]) {
  const all = () => { const b = new ArrayBuffer(n * 4, { maxByteLength: n * 8 }); return b; };
  { const b = all(), v = new Int32Array(b); fill(v, 0); let k = 0; attempt("shrink", () => v.sort((x, y) => { if (++k === at) b.resize(8); return x - y; })); b.resize(n * 4); report("shrunk", v); }
  { const b = all(), v = new Int32Array(b); fill(v, 0); let k = 0; attempt("grow", () => v.sort((x, y) => { if (++k === at) b.resize(n * 8); return x - y; })); report("grown", v); }
  { const b = all(), v = new Int32Array(b, 4, n - 1); fill(v, 0); let k = 0; attempt("outside", () => v.sort((x, y) => { if (++k === at) b.resize(4); return x - y; })); b.resize(n * 4); report("outside", new Int32Array(b)); }
  { const b = all(), v = new Int32Array(b, 4, n - 1); fill(v, 0); b.resize(4); attempt("outside at first", () => v.sort((x, y) => { calls++; return x - y; })); report("o", new Int32Array(b)); }
  { const v = new Uint16Array(n); fill(v, 0); let k = 0; attempt("detach", () => v.sort((x, y) => { calls++; if (++k === at) v.buffer.transfer(); return x - y; })); report("detached", v); attempt("detached at first", () => v.sort((x, y) => x - y)); attempt("detached default", () => v.sort()); attempt("detached bad", () => v.sort(5 as any)); }
  { const v = new Int8Array(n); fill(v, 0); let k = 0; attempt("write", () => v.sort((x, y) => { calls++; if (++k === at) v.fill(1); return x - y; })); report("written", v); }
  { const v = new Int32Array(n); fill(v, 0); let k = 0; attempt("buffer", () => v.sort((x, y) => { if (++k === at) void v.buffer; return x - y; })); report("buffer", v); }
  { const v = new Int32Array(n); fill(v, 0); let k = 0; attempt("nested", () => v.sort((x, y) => { calls++; if (++k === at) v.sort((p, q) => { calls++; return q - p; }); return x - y; })); report("nested", v); }
  { const v = new Int32Array(new SharedArrayBuffer(n * 4)); fill(v, 0); attempt("shared", () => v.sort((x, y) => x - y)); report("shared", v); }
  { const s = new SharedArrayBuffer(n * 4, { maxByteLength: n * 8 }), v = new Int32Array(s); fill(v, 0); let k = 0; attempt("growable", () => v.sort((x, y) => { if (++k === at) s.grow(n * 8); return x - y; })); report("growable", v); }
  { const v = new Int16Array(n + 6).subarray(3, n + 3); fill(v, 0); attempt("sub", () => v.sort((x, y) => y - x)); report("sub", new Int16Array(v.buffer)); }
  { const v = Buffer.alloc(n); fill(v, 0); attempt("Buffer", () => v.sort((x, y) => { calls++; return y - x; })); report("Buffer", v); }
}
class Ints extends Int32Array { sort(f?: any): this { calls++; return super.sort(f); } }
class Plain extends Uint8Array { extra = 5; get [Symbol.toStringTag](): any { return "Plain"; } }
class Own extends Int16Array { constructor(n: any) { super(n); (this as any).sort = (f: any) => { out.push("own"); return Int16Array.prototype.sort.call(this, f); }; } }
for (const n of [2, 30, 130]) {
  { const v = new Ints(n); fill(v, 0); attempt("Ints", () => v.sort((a: number, b: number) => a - b)); report("Ints", v); }
  { const v = new Plain(n); fill(v, 0); attempt("Plain", () => v.sort((a, b) => b - a)); report("Plain", v); }
  { const v = new Own(n); fill(v, 0); attempt("Own", () => v.sort((a, b) => b - a)); report("Own", v); }
  { const v = new Int32Array(n); fill(v, 0); attempt("call", () => Uint8Array.prototype.sort.call(v as any, (a: number, b: number) => a - b)); report("call", v); fill(v, 0); attempt("apply", () => Reflect.apply(Int32Array.prototype.sort, v, [(a: number, b: number) => b - a])); report("apply", v); fill(v, 0);
    const args: any = [(a: number, b: number) => a - b]; attempt("spread", () => (v.sort as any)(...args)); attempt("spread2", () => (v as any).sort(...args)); report("spread", v); fill(v, 0); attempt("optional", () => v?.sort?.((a, b) => b - a)); report("optional", v); fill(v, 0); const key: any = "sort"; attempt("key", () => (v as any)[key]((a: number, b: number) => a - b)); report("key", v);
    fill(v, 0); const bound = v.sort.bind(v); attempt("bound", () => bound((a, b) => a - b)); report("bound", v); }
  for (const other of [[3, 1, 2], "cba", { length: 2 }, null, undefined, 5, new DataView(new ArrayBuffer(8)), new ArrayBuffer(4)] as any[]) attempt("other", () => Int32Array.prototype.sort.call(other, (a: number, b: number) => a - b));
}
out.push(String(Int32Array.prototype.sort.name), String(Int32Array.prototype.sort.length), String((Int32Array.prototype.sort as any) === Uint8Array.prototype.sort), String(Object.getPrototypeOf(Int8Array.prototype).sort === Int32Array.prototype.sort), String(Int32Array.prototype.sort));
console.log(out.join("\n"));
