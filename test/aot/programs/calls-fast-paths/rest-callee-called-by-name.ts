// A large method with a rest parameter that only reads its rest arguments: no array is allocated for the call.
// IR+ CallDirect \(v[0-9]+, v[0-9]+, v[0-9]+\) function=f[0-9]+
declare const console: any;
function pad(n: number): number { let s = 0; for (let i = 0; i < n; i++) { s += i * 3; s ^= i << 2; s += s % 7; s -= i & 5; s += (s >> 3) + (i | 9); s ^= s * 31; s += i % 11; s -= s & 255; s += i * i; s ^= s >>> 5; s += (i + 1) * 13; s -= s % 17; s ^= i * 7; s += s & 63; s -= i >> 1; s += s % 29; s ^= i + 19; s += (s | 3) - i; s -= s % 5; s ^= s << 1; } return s; }
class Emitter { count = 0; emit(type: string, ...r: unknown[]): boolean { if (type === "never") this.count += pad(r.length); switch (r.length) { case 0: this.count++; break; case 1: if (r[0] !== undefined) this.count += 2; break; default: if (r[1] !== undefined) this.count += r.length; }
  if (type === "never2") this.count += pad(r.length + 1) + pad(r.length + 2) + pad(r.length + 3) + pad(r.length + 4) + pad(r.length + 5) + pad(r.length + 6) + pad(r.length + 7) + pad(r.length + 8) + pad(r.length + 9) + pad(r.length + 10) + pad(r.length + 11) + pad(r.length + 12) + pad(r.length + 13) + pad(r.length + 14) + pad(r.length + 15) + pad(r.length + 16) + pad(r.length + 17) + pad(r.length + 18) + pad(r.length + 19) + pad(r.length + 20);
  if (type === "never3") this.count += pad(r.length + 1) + pad(r.length + 2) + pad(r.length + 3) + pad(r.length + 4) + pad(r.length + 5) + pad(r.length + 6) + pad(r.length + 7) + pad(r.length + 8) + pad(r.length + 9) + pad(r.length + 10) + pad(r.length + 11) + pad(r.length + 12) + pad(r.length + 13) + pad(r.length + 14) + pad(r.length + 15) + pad(r.length + 16) + pad(r.length + 17) + pad(r.length + 18) + pad(r.length + 19) + pad(r.length + 20);
  if (type === "never4") this.count += pad(r.length + 1) + pad(r.length + 2) + pad(r.length + 3) + pad(r.length + 4) + pad(r.length + 5) + pad(r.length + 6) + pad(r.length + 7) + pad(r.length + 8) + pad(r.length + 9) + pad(r.length + 10) + pad(r.length + 11) + pad(r.length + 12) + pad(r.length + 13) + pad(r.length + 14) + pad(r.length + 15) + pad(r.length + 16) + pad(r.length + 17) + pad(r.length + 18) + pad(r.length + 19) + pad(r.length + 20);
  if (type === "never5") this.count += pad(r.length + 1) + pad(r.length + 2) + pad(r.length + 3) + pad(r.length + 4) + pad(r.length + 5) + pad(r.length + 6) + pad(r.length + 7) + pad(r.length + 8) + pad(r.length + 9) + pad(r.length + 10) + pad(r.length + 11) + pad(r.length + 12) + pad(r.length + 13) + pad(r.length + 14) + pad(r.length + 15) + pad(r.length + 16) + pad(r.length + 17) + pad(r.length + 18) + pad(r.length + 19) + pad(r.length + 20);
  return type === "x"; } }
const e = new Emitter();
const types = ["x", "y"];
let n = 0;
for (let i = 0; i < 3_000_000; i++) if (e.emit(types[i & 1], i, "s")) n++;
console.log(n, e.count);
export {};
