declare const process: any;
const log: string[] = [];
function show(v: any): string {
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "bigint") return v + "n"; if (typeof v === "function") return "fn";
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) { let s = "[" + v.length + ":"; let n = 0; for (const k of Object.keys(v)) { if (n++ > 40) break; s += k + "=" + show((v as any)[k]) + ","; } return s + "]"; }
  if (ArrayBuffer.isView(v)) return Object.prototype.toString.call(v) + Array.prototype.join.call(v, ",") + Object.keys(v).slice(-2).join(",");
  if (typeof v === "object" && v !== null) return "{" + Object.keys(v).map(k => k + "=" + (typeof v[k] === "object" ? "o" : show(v[k]))).join(",") + "}";
  return String(v);
}
function attempt(name: string, f: () => any) { try { log.push(name + " " + show(f())); } catch (e: any) { log.push(name + " threw " + (e && e.constructor && e.constructor.name) + " " + String(e && e.message).slice(0, 50)); } }
const keys: any[] = [0, 1, 2, 3, -0, -1, 1.5, 0.5, -0.5, 2.9999999999999996, NaN, Infinity, -Infinity, 7, 4, 2147483647, 2147483648, -2147483648, 4294967294, 4294967295, 4294967296, 9007199254740992, 9223372036854775808, -9223372036854775808, 1e300, 5e-324, undefined, null, "1", "x", true];
class Holder { constructor(public at: number, public other: number = 0) {} }
class Below extends Array<number> {}
function made(kind: number): any {
  switch (kind) {
    case 0: return [1, 2, 3, 0, 2];
    case 1: return [1.5, 2, -0, NaN, 3];
    case 2: return [1, "x", { valueOf() { return 2; } }, null, 3];
    case 3: return [1, , 3, , 2];
    case 4: return [];
    case 5: { const a: any = [3, 1, 2, 0]; a["1.5"] = 11; a["-1"] = 12; a["NaN"] = 13; a["Infinity"] = 14; return a; }
    case 6: return new Float64Array([1, 2, 0.5, 3]);
    case 7: return new Uint8Array([3, 2, 1, 0]);
    case 8: return "3120";
    case 9: return { 0: 1, 1: 2, 2: 3, "1.5": 4, "-1": 5, length: 3 };
    case 10: return Object.freeze([2, 1, 0]);
    case 11: return Below.from([2, 0, 1]);
    case 12: { const a: any = [2, 3, 1, 0]; Object.defineProperty(a, 1, { get() { return 2; }, set(v) { log.push("set " + show(v)); }, configurable: true }); return a; }
    case 13: { const a: number[] = []; for (let i = 0; i < 300; i++) a.push((i * 7) % 300); return a; }
    case 14: return new Array(5).fill(Infinity);
    default: return new Array(6).fill(0);
  }
}
const kinds = 16;
function every(name: string, f: (a: any, b: any, k: any, h: any) => any) {
  for (let i = 0; i < kinds; i++) for (const k of keys) { const a = made(i), b = made((i * 5 + 3) % kinds); attempt(name + " " + i + " " + show(k), () => [f(a, b, k, typeof k === "number" ? new Holder(k, 1) : { at: k, other: 2 }), typeof a === "object" ? show(a) : "", typeof b === "object" ? show(b) : ""]); }
}

function t0(a: number[], b: number[], k: number = 2, h: Holder = new Holder(1)): any { let x: number = 0; const j = Math.trunc(k); x += +b[j]!; x += a[j]!; a[j]!++; return x; }
every("t0", (a, b, k, h) => t0(a, b, k, h));
function t1(a: number[], b: any, k: any, h: Holder = new Holder(1)): any { let x: number = 0; for (let i = 0; i < 3; i++) { a[k] = a[k]!; x += b[k]!; b[k]! += -0; a[k] = NaN; } return x; }
every("t1", (a, b, k, h) => t1(a, b, k, h));
function t2(a: number[], b: number[], k: number, h: Holder = new Holder(1)): any { let x: number = 0; if (x > 0) return x + 100; b[k] ??= k + 1; x += (k in a ? a[k]! : 0.25); b[k] = (k in a ? a[k]! : 0.25); return x; }
every("t2", (a, b, k, h) => t2(a, b, k, h));
function t3(a: number[], b: number[], k: number, h: Holder = new Holder(1)): any { let x: number = 0; a[k]! += k; a[k] = (a[k]! | 0); a[k]!++; if ((b[k]! | 0) < x) b[k] = -1; return x; }
every("t3", (a, b, k, h) => t3(a, b, k, h));
function t4(a: number[], b: any, k: number, h: Holder = new Holder(1)): any { let x: number = 0; for (const v of [0, 1, 2.5]) { const j = k + v; x += (a[j]! | 0); x += (k in b ? b[j]! : 0.25); b[j]! += -1; } return x; }
every("t4", (a, b, k, h) => t4(a, b, k, h));
function t5(a: number[], b: number[], k: number, h: Holder = new Holder(1)): any { let x: number = 0; a[k] = 1; b[k] = x; a[k]! += NaN; x += (a[k] ?? -1); a[k] = x; return x; }
every("t5", (a, b, k, h) => t5(a, b, k, h));
function t6(a: number[], b: number[], k: number, h: Holder = new Holder(1)): any { let x: number = 0; if (k > 2) return x + 100; b[k]!++; b[k] ??= x; return x; }
every("t6", (a, b, k, h) => t6(a, b, k, h));
function t7(a: number[], b: any, k: any, h: Holder = new Holder(1)): any { let x: number = 0; for (const v of [0, 1, 2.5]) { const j = k + v; x += b[j]!; a[j]! += k; a[j] ??= 0.5; } return x; }
every("t7", (a, b, k, h) => t7(a, b, k, h));
function t8(a: number[], b: number[], k: any, h: Holder = new Holder(1)): any { let x: number = 0; try { if (+a[k]! < x) a[k] = 1; (a as any)[k] = "s"; b[k]!++; x += (b[k] ?? -1); } catch (e: any) { x += 1000; b[k]!++; } return x; }
every("t8", (a, b, k, h) => t8(a, b, k, h));
class Walk { private readonly next: number[] = []; private readonly level: number[]; constructor(private readonly n: number) { for (let i = 0; i < n; i++) this.next.push((i * 5 + 2) % n); this.level = new Array<number>(n).fill(0); }
  go(v: number, deep: number): number { if (deep === 0) return v; for (; this.level[v]! < 3; this.level[v]!++) { if (this.next[v]! > this.level[v]!) { const r = this.go(this.next[v]!, deep - 1); if (r > this.level[v]!) return r; } } return this.level[v]! + this.next[v]!; } }
for (const n of [1, 3, 8, 20]) for (const v of [0, 1, 0.5, -1, NaN, 2.5, 7, 100]) attempt("walk", () => { const w = new Walk(n); return [w.go(v, 3), w]; });
let digest = 0; for (const l of log) for (let i = 0; i < l.length; i++) digest = (digest * 31 + l.charCodeAt(i)) | 0;
console.log(log.length, digest);
console.log(process.argv[2] === "all" ? log.join("\n") : log.filter((_, i) => i % 61 === 0).join("\n"));
