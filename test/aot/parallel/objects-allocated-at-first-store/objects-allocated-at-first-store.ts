// @ts-nocheck

const log: string[] = [];
function show(v: any): string {
  if (v === null) return "null";
  if (typeof v === "number") return Object.is(v, -0) ? "-0" : String(v);
  if (typeof v === "bigint") return v + "n";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "function") return "fn:" + v.name + "/" + v.length;
  if (typeof v === "symbol") return "symbol";
  if (Array.isArray(v)) { let s = "["; for (let i = 0; i < v.length; i++) s += (i in v ? show(v[i]) : "hole") + ","; return s + "]"; }
  if (typeof v === "object") return (v.constructor ? v.constructor.name : "none") + "{" + Object.keys(v).map(k => k + ":" + (v[k] === v ? "itself" : typeof v[k] === "object" && v[k] !== null && !Array.isArray(v[k]) ? "object" : show(v[k]))).join(",") + "}";
  return String(v);
}
const odd: any[] = [0, -0, 1, -1, 0.5, 1e300, -1e300, NaN, Infinity, -Infinity, 2147483647, -2147483648, 2147483648, 4294967295, 4294967296, 9007199254740991, 9007199254740992, 9007199254740993, 5e-324, undefined, null, true, "7", "x", 3n, { valueOf() { return 4.5; } }, [6], [1, 2], Symbol.iterator];
const numbers: number[] = [0, -0, 1.5, -1, NaN, Infinity, 2 ** 31, 2 ** 53 + 2, -0.25, 7];
const holes: number[] = [1, , 2.5, , 3] as any;
let effects = 0;
function effect(x: any) { effects++; return x; }
function attempt(name: string, f: () => any) { try { log.push(name + " " + show(f())); } catch (e: any) { log.push(name + " threw " + (e && e.constructor && e.constructor.name) + " " + String(e && e.message).slice(0, 60)); } }

class K0 {
  f0 = 7;
  f1: number;
  f2: K0 | null = null;
  constructor(readonly a0?: number, a1 = 3, readonly a2?: number, a3 = -0) {
    const t = a1 * 2 + 2147483648;
    if (a3 > 1e200) throw new RangeError("large");
    this.f0 = a1;
    this.f1 = (a0 ?? 7) > 1 ? (a0 ?? -0) : 7;
  }
  total(): number { return (this.a0 ?? 0) + (this.a2 ?? 0) + this.f0 + this.f1; }
}
function loop0(m: number): string {
  const list: K0[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K0(i, 1, i - 0.5, i / 3); const two = i & 1 ? new K0(sum, sum, sum * 0.25) : new K0(); list.push(one, two); sum += one.total(); if (i & 4) list.push(new K0(m - 0.5, m, m * 0.25)); }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k0", () => loop0(m));
for (const v of odd) attempt("j0", () => { const o: any = new (K0 as any)(v, v); return show(o) + Object.getOwnPropertyNames(o).join(); });
class K1 {
  f0: number;
  f1: number;
  constructor(a0?: number) {
    const t = (a0 ?? Infinity) * 2 + 7;
    this.f0 = (a0 ?? 0) * 0.5;
    this.f1 = numbers.length + (a0 ?? 0);
  }
  total(): number { return this.f0 + this.f1; }
}
function loop1(m: number): string {
  const list: K1[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K1(NaN); const two = i & 1 ? new K1(-1) : new K1(i * 0.25); list.push(one, two); sum += one.total(); if (i & 4) list.push(new K1(m * 0.25)); }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k1", () => loop1(m));
class C2 {
  f0: number;
  f1 = Infinity;
  f2 = -0;
  constructor(a0 = effect(7), a1: any) {
    this.f0 = effect(a0);
    this.f1 = a0 as any;
    Object.freeze(this);
  }
  sum(x = 0, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
class D2 extends C2 { extra = NaN; constructor(b0 = 3, b1?: number) { super(1, undefined as any); (this as any).own = b1; } }
function make2(x: number, y?: number) { const o: any = new C2(7, undefined as any); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m2", () => make2(x)); attempt("M2", () => make2(x, x * 2)); attempt("u2", () => make2(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h2", () => make2(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o2", () => show(new (C2 as any)(v, v, v, v)) + effects); attempt("r2", () => show(Reflect.construct(C2 as any, [v], D2 as any))); attempt("s2", () => show(new (C2 as any)(...[v, 1]))); }
for (const x of numbers) { attempt("d2", () => show(new D2(x))); attempt("e2", () => show(new D2(undefined, x))); attempt("n2", () => show(new D2())); }
log.push("l2 " + C2.length + (C2 as any).prototype.sum.length);
function g2(x: number, y = 2147483648, z?: number): any { const r = Math.max(x, y); return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h2 = (x: number, y = numbers[2]!): number => x < y ? x : y;
function k2(n: number, acc?: number): any { return n <= 0 ? acc : k2(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g2", () => [g2(x), g2(x, x), g2(x, undefined, x), g2(1.5, 2.5, 3.5), h2(x), h2(x, x / 2), h2(x, undefined), k2(x > 10 ? 3 : 2, x), k2(3)].map(show).join(";")); }
for (const v of odd) attempt("G2", () => [(g2 as any)(v, v, v), (h2 as any)(1, v), (g2 as any).call(null, 1, v), (h2 as any).apply(null, [v]), (g2 as any).bind(null, 2)(v)].map(show).join(";"));
class C3 {
  f0 = NaN;
  f1 = new Map<string, number>();
  f2: any = null;
  constructor(a0: any) {
  }
  sum(x = 2147483648, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
class D3 extends C3 { extra = 1; constructor(b0 = 1, b1?: number) { super(b0); (this as any).own = b1; } }
function make3(x: number, y?: number) { const o: any = new C3(Infinity); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m3", () => make3(x)); attempt("M3", () => make3(x, x * 2)); attempt("u3", () => make3(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h3", () => make3(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o3", () => show(new (C3 as any)(v, v, v, v)) + effects); attempt("r3", () => show(Reflect.construct(C3 as any, [v], D3 as any))); attempt("s3", () => show(new (C3 as any)(...[v, 1]))); }
for (const x of numbers) { attempt("d3", () => show(new D3(x))); attempt("e3", () => show(new D3(undefined, x))); attempt("n3", () => show(new D3())); }
log.push("l3 " + C3.length + (C3 as any).prototype.sum.length);
function g3(x: number, y = Infinity, z?: number): any { const r = x | y; return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h3 = (x: number, y = numbers.length): number => x + y;
function k3(n: number, acc?: number): any { return n <= 0 ? acc : k3(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g3", () => [g3(x), g3(x, x), g3(x, undefined, x), g3(1.5, 2.5, 3.5), h3(x), h3(x, x / 2), h3(x, undefined), k3(x > 10 ? 3 : 2, x), k3(3)].map(show).join(";")); }
for (const v of odd) attempt("G3", () => [(g3 as any)(v, v, v), (h3 as any)(1, v), (g3 as any).call(null, 1, v), (h3 as any).apply(null, [v]), (g3 as any).bind(null, 2)(v)].map(show).join(";"));
class K4 {
  f0: number;
  f1 = NaN;
  f2: number;
  f3 = { u: 1, v: "w" };
  constructor(readonly a0 = 1) {
    const t = a0 * 2 + 0.5;
    this.f0 = a0 * 0.5;
    this.f1 = a0;
    this.f2 = a0 > 1 ? a0 : 1;
  }
  total(): number { return this.a0 + this.f0 + this.f1 + this.f2; }
}
function loop4(m: number): string {
  const list: K4[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K4(); const two = i & 1 ? new K4(Infinity) : new K4(i / 3); list.push(one, two); sum += one.total();  }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k4", () => loop4(m));
for (const v of odd) attempt("j4", () => { const o: any = new (K4 as any)(v, v); return show(o) + Object.getOwnPropertyNames(o).join(); });
class C5 {
  f0: number[] = [];
  constructor(public a0: any, private a1 = effect(Infinity), public a2: number) {
    const t = effect(a0) as any;
  }
  sum(x = -0, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
class D5 extends C5 { extra = 0; constructor(b0 = -0, b1?: number) { super(b1 as any, 1e21, b1 as any); (this as any).own = b1; } }
function make5(x: number, y?: number) { const o: any = new C5(x, Infinity, y as any); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m5", () => make5(x)); attempt("M5", () => make5(x, x * 2)); attempt("u5", () => make5(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h5", () => make5(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o5", () => show(new (C5 as any)(v, v, v, v)) + effects); attempt("r5", () => show(Reflect.construct(C5 as any, [v], D5 as any))); attempt("s5", () => show(new (C5 as any)(...[v, 1]))); }
for (const x of numbers) { attempt("d5", () => show(new D5(x))); attempt("e5", () => show(new D5(undefined, x))); attempt("n5", () => show(new D5())); }
log.push("l5 " + C5.length + (C5 as any).prototype.sum.length);
function g5(x: number, y = -0, z?: number): any { const r = x < y ? 1 : 2; return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h5 = (x: number, y = x + 1): number => x < y ? x : y;
function k5(n: number, acc?: number): any { return n <= 0 ? acc : k5(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g5", () => [g5(x), g5(x, x), g5(x, undefined, x), g5(1.5, 2.5, 3.5), h5(x), h5(x, x / 2), h5(x, undefined), k5(x > 10 ? 3 : 2, x), k5(3)].map(show).join(";")); }
for (const v of odd) attempt("G5", () => [(g5 as any)(v, v, v), (h5 as any)(1, v), (g5 as any).call(null, 1, v), (h5 as any).apply(null, [v]), (g5 as any).bind(null, 2)(v)].map(show).join(";"));
class K6 {
  f0: number;
  f1 = true;
  f2: K6 | null = null;
  f3 = "s6";
  constructor(readonly a0: number, a1: number) {
    if (a1 > 1e200) throw new RangeError("large");
    this.f0 = Math.sqrt(a0);
    this.f2 = this;
  }
  total(): number { return this.a0 + this.f0; }
}
function loop6(m: number): string {
  const list: K6[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K6(3, i / 3); const two = i & 1 ? new K6(sum - 0.5, sum * 0.25) : new K6(-1, i / 3); list.push(one, two); sum += one.total();  }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k6", () => loop6(m));
class K7 {
  f0 = { u: 1, v: "w" };
  constructor(readonly a0?: number) {
  }
  total(): number { return (this.a0 ?? 0); }
}
function loop7(m: number): string {
  const list: K7[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K7(i * 0.25); const two = i & 1 ? new K7(sum * 0.25) : new K7(i - 0.5); list.push(one, two); sum += one.total(); if (i & 4) list.push(new K7(m * 0.25)); }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k7", () => loop7(m));
class C8 {
  f0 = { u: 1, v: 1 };
  #f1 = 2147483648;
  constructor(a0: number, a1: number = 7) {
    this.#f1 = a0 as any;
  }
  get pf1() { return this.#f1; }
  sum(x = 0.5, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
function make8(x: number, y?: number) { const o: any = new C8(y as any); return show(o) + show(o.pf1) + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m8", () => make8(x)); attempt("M8", () => make8(x, x * 2)); attempt("u8", () => make8(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h8", () => make8(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o8", () => show(new (C8 as any)(v, v, v, v)) + effects); attempt("r8", () => show(Reflect.construct(C8 as any, [v], C8 as any))); attempt("s8", () => show(new (C8 as any)(...[v, 1]))); }
log.push("l8 " + C8.length + (C8 as any).prototype.sum.length);
function g8(x: number, y = 0.5, z?: number): any { const r = Math.max(x, y); return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h8 = (x: number, y = x + 1): number => x < y ? x : y;
function k8(n: number, acc?: number): any { return n <= 0 ? acc : k8(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g8", () => [g8(x), g8(x, x), g8(x, undefined, x), g8(1.5, 2.5, 3.5), h8(x), h8(x, x / 2), h8(x, undefined), k8(x > 10 ? 3 : 2, x), k8(3)].map(show).join(";")); }
for (const v of odd) attempt("G8", () => [(g8 as any)(v, v, v), (h8 as any)(1, v), (g8 as any).call(null, 1, v), (h8 as any).apply(null, [v]), (g8 as any).bind(null, 2)(v)].map(show).join(";"));
class C9 {
  f0 = { u: 1, v: 7 };
  constructor(a0 = numbers[2]!, readonly a1: number = numbers.length) {
    const t = effect(a0) as any;
    (this as any).late = a0;
  }
  sum(x = 3, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
function make9(x: number, y?: number) { const o: any = new C9(3); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m9", () => make9(x)); attempt("M9", () => make9(x, x * 2)); attempt("u9", () => make9(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h9", () => make9(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o9", () => show(new (C9 as any)(v, v, v, v)) + effects); attempt("r9", () => show(Reflect.construct(C9 as any, [v], C9 as any))); attempt("s9", () => show(new (C9 as any)(...[v, 1]))); }
log.push("l9 " + C9.length + (C9 as any).prototype.sum.length);
function g9(x: number, y = 1, z?: number): any { const r = x - y; return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h9 = (x: number, y = numbers.length): number => Math.sqrt(x * x + y * y);
function k9(n: number, acc?: number): any { return n <= 0 ? acc : k9(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g9", () => [g9(x), g9(x, x), g9(x, undefined, x), g9(1.5, 2.5, 3.5), h9(x), h9(x, x / 2), h9(x, undefined), k9(x > 10 ? 3 : 2, x), k9(3)].map(show).join(";")); }
for (const v of odd) attempt("G9", () => [(g9 as any)(v, v, v), (h9 as any)(1, v), (g9 as any).call(null, 1, v), (h9 as any).apply(null, [v]), (g9 as any).bind(null, 2)(v)].map(show).join(";"));
class K10 {
  #f0 = -0;
  constructor(a0: number, public a1: number) {
    const t = a0 * 2 + NaN;
    this.#f0 = a1;
  }
  get pf0(): number { return this.#f0; }
  total(): number { return this.a1 + this.pf0; }
}
function loop10(m: number): string {
  const list: K10[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K10(0.5, i); const two = i & 1 ? new K10(sum * 0.25, sum - 0.5) : new K10(i - 0.5, 0.5); list.push(one, two); sum += one.total();  }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k10", () => loop10(m));
class C11 {
  constructor(private a0: any, private a1: number = 2147483648, readonly a2 = numbers.length, readonly a3 = 1) {
    const t = effect(a0) as any;
  }
  sum(x = 7, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
class D11 extends C11 { extra = 0.5; constructor(b0 = 7, b1?: number) { super(b1 as any, b0, undefined as any, b1 as any); (this as any).own = b1; } }
function make11(x: number, y?: number) { const o: any = new C11(undefined as any); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m11", () => make11(x)); attempt("M11", () => make11(x, x * 2)); attempt("u11", () => make11(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h11", () => make11(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o11", () => show(new (C11 as any)(v, v, v, v)) + effects); attempt("r11", () => show(Reflect.construct(C11 as any, [v], D11 as any))); attempt("s11", () => show(new (C11 as any)(...[v, 1]))); }
for (const x of numbers) { attempt("d11", () => show(new D11(x))); attempt("e11", () => show(new D11(undefined, x))); attempt("n11", () => show(new D11())); }
log.push("l11 " + C11.length + (C11 as any).prototype.sum.length);
function g11(x: number, y = 1, z?: number): any { const r = x + y; return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h11 = (x: number, y = effect(1e21)): number => Math.sqrt(x * x + y * y);
function k11(n: number, acc?: number): any { return n <= 0 ? acc : k11(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g11", () => [g11(x), g11(x, x), g11(x, undefined, x), g11(1.5, 2.5, 3.5), h11(x), h11(x, x / 2), h11(x, undefined), k11(x > 10 ? 3 : 2, x), k11(3)].map(show).join(";")); }
for (const v of odd) attempt("G11", () => [(g11 as any)(v, v, v), (h11 as any)(1, v), (g11 as any).call(null, 1, v), (h11 as any).apply(null, [v]), (g11 as any).bind(null, 2)(v)].map(show).join(";"));
class K12 {
  f0: K12 | null = null;
  f1: K12 | null = null;
  f2: K12 | null = null;
  constructor(a0?: number, public a1?: number) {
    const t = (a0 ?? -0) * 2 + 3;
    this.f0 = this;
  }
  total(): number { return (this.a1 ?? 0); }
}
function loop12(m: number): string {
  const list: K12[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K12(Infinity, i / 3); const two = i & 1 ? new K12(sum - 0.5, sum / 3) : new K12(i / 3, i); list.push(one, two); sum += one.total();  }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k12", () => loop12(m));
class K13 {
  f0: K13 | null = null;
  constructor(public a0: number, readonly a1: number, a2: number, public a3?: number) {
    if ((a3 ?? -0) > 1e200) throw new RangeError("large");
    this.f0 = this;
  }
  total(): number { return this.a0 + this.a1 + (this.a3 ?? 0); }
}
function loop13(m: number): string {
  const list: K13[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K13(NaN, i, i - 0.5); const two = i & 1 ? new K13(sum - 0.5, -0, 1e21) : new K13(NaN, i / 3, i * 0.25, i); list.push(one, two); sum += one.total();  }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k13", () => loop13(m));
class C14 {
  f0 = false;
  f1: number;
  constructor(private a0 = numbers[2]!, public a1: number) {
    if (a0 === -1) throw new RangeError("no " + a0);
    this.f1 = -0;
  }
  sum(x = 1, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
function make14(x: number, y?: number) { const o: any = new C14(y as any, x | 0); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m14", () => make14(x)); attempt("M14", () => make14(x, x * 2)); attempt("u14", () => make14(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h14", () => make14(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o14", () => show(new (C14 as any)(v, v, v, v)) + effects); attempt("r14", () => show(Reflect.construct(C14 as any, [v], C14 as any))); attempt("s14", () => show(new (C14 as any)(...[v, 1]))); }
log.push("l14 " + C14.length + (C14 as any).prototype.sum.length);
function g14(x: number, y = Infinity, z?: number): any { const r = x % y; return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h14 = (x: number, y = numbers.length): number => x < y ? x : y;
function k14(n: number, acc?: number): any { return n <= 0 ? acc : k14(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g14", () => [g14(x), g14(x, x), g14(x, undefined, x), g14(1.5, 2.5, 3.5), h14(x), h14(x, x / 2), h14(x, undefined), k14(x > 10 ? 3 : 2, x), k14(3)].map(show).join(";")); }
for (const v of odd) attempt("G14", () => [(g14 as any)(v, v, v), (h14 as any)(1, v), (g14 as any).call(null, 1, v), (h14 as any).apply(null, [v]), (g14 as any).bind(null, 2)(v)].map(show).join(";"));
class K15 {
  f0: K15 | null = null;
  constructor(readonly a0?: number, public a1 = NaN) {
    this.f0 = this;
  }
  total(): number { return (this.a0 ?? 0) + this.a1; }
}
function loop15(m: number): string {
  const list: K15[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K15(); const two = i & 1 ? new K15() : new K15(0.5); list.push(one, two); sum += one.total(); if (i & 4) list.push(new K15()); }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k15", () => loop15(m));
console.log(log.length + " " + effects);
let digest = 0; for (const line of log) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(digest);
console.log(process.argv[2] === "all" ? log.join("\n") : log.filter((_, i) => i % 61 === 0).join("\n"));
