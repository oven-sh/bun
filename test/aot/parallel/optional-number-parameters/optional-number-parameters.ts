declare const process: any;

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
  f0: K0 | null = null;
  f1: number;
  constructor(public a0: number, public a1 = 1e21, readonly a2?: number) {
    if ((a2 ?? 7) > 1e200) throw new RangeError("large");
    this.f1 = Math.sqrt((a2 ?? 0.5));
  }
  total(): number { return this.a0 + this.a1 + (this.a2 ?? 0) + this.f1; }
}
function loop0(m: number): string {
  const list: K0[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K0(i - 0.5, -1); const two = i & 1 ? new K0(2147483648, sum) : new K0(-1, i - 0.5, i - 0.5); list.push(one, two); sum += one.total();  }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k0", () => loop0(m));
class K1 {
  f0 = false;
  constructor(public a0 = NaN, readonly a1?: number) {
  }
  total(): number { return this.a0 + (this.a1 ?? 0); }
}
function loop1(m: number): string {
  const list: K1[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K1(); const two = i & 1 ? new K1(sum) : new K1(i * 0.25, i - 0.5); list.push(one, two); sum += one.total(); if (i & 4) list.push(new K1()); }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k1", () => loop1(m));
for (const v of odd) attempt("j1", () => { const o: any = new (K1 as any)(v, v); return show(o) + Object.getOwnPropertyNames(o).join(); });
class C2 {
  f0 = () => this;
  f1 = "s";
  f2 = { u: 1, v: -1 };
  f3 = "s";
  constructor(a0 = effect(1e21), a1: any) {
    const t = effect(a0) as any;
    (this as any).late = a0;
  }
  sum(x = NaN, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
function make2(x: number, y?: number) { const o: any = new C2(x, undefined as any); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m2", () => make2(x)); attempt("M2", () => make2(x, x * 2)); attempt("u2", () => make2(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h2", () => make2(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o2", () => show(new (C2 as any)(v, v, v, v)) + effects); attempt("r2", () => show(Reflect.construct(C2 as any, [v], C2 as any))); attempt("s2", () => show(new (C2 as any)(...[v, 1]))); }
log.push("l2 " + C2.length + (C2 as any).prototype.sum.length);
function g2(x: number, y = -0, z?: number): any { const r = x < y ? 1 : 2; return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h2 = (x: number, y = effect(7)): number => y;
function k2(n: number, acc?: number): any { return n <= 0 ? acc : k2(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g2", () => [g2(x), g2(x, x), g2(x, undefined, x), g2(1.5, 2.5, 3.5), h2(x), h2(x, x / 2), h2(x, undefined), k2(x > 10 ? 3 : 2, x), k2(3)].map(show).join(";")); }
for (const v of odd) attempt("G2", () => [(g2 as any)(v, v, v), (h2 as any)(1, v), (g2 as any).call(null, 1, v), (h2 as any).apply(null, [v]), (g2 as any).bind(null, 2)(v)].map(show).join(";"));
class K3 {
  f0 = { u: 1, v: "w" };
  f1 = -1;
  f2 = true;
  f3: K3 | null = null;
  f4 = true;
  f5: number;
  constructor(public a0 = 3) {
    this.f1 = a0;
    this.f5 = a0 > 1 ? a0 : NaN;
  }
  total(): number { return this.a0 + this.f1 + this.f5; }
}
function loop3(m: number): string {
  const list: K3[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K3(2147483648); const two = i & 1 ? new K3() : new K3(); list.push(one, two); sum += one.total();  }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k3", () => loop3(m));
class K4 {
  f0 = -0;
  constructor(readonly a0: number, public a1 = -1, public a2?: number) {
    const t = (a2 ?? NaN) * 2 + -0;
    if (a1 > 1e200) throw new RangeError("large");
    this.f0 = a0;
  }
  total(): number { return this.a0 + this.a1 + (this.a2 ?? 0) + this.f0; }
}
function loop4(m: number): string {
  const list: K4[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K4(i / 3); const two = i & 1 ? new K4(sum - 0.5, sum * 0.25) : new K4(-1, i * 0.25, i - 0.5); list.push(one, two); sum += one.total(); if (i & 4) list.push(new K4(2147483648, m - 0.5)); }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k4", () => loop4(m));
class K5 {
  f0: K5 | null = null;
  constructor(readonly a0?: number, readonly a1?: number) {
    const t = (a1 ?? NaN) * 2 + 7;
    this.f0 = this;
  }
  total(): number { return (this.a0 ?? 0) + (this.a1 ?? 0); }
}
function loop5(m: number): string {
  const list: K5[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K5(); const two = i & 1 ? new K5(sum / 3, sum) : new K5(i / 3); list.push(one, two); sum += one.total(); if (i & 4) list.push(new K5(7)); }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k5", () => loop5(m));
for (const v of odd) attempt("j5", () => { const o: any = new (K5 as any)(v, v); return show(o) + Object.getOwnPropertyNames(o).join(); });
class C6 {
  f0 = { u: 1, v: 1 };
  constructor(a0 = Infinity, private a1?: number, public a2 = effect(Infinity)) {
  }
  sum(x = 1e21, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
function make6(x: number, y?: number) { const o: any = new C6(0.5, undefined as any); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m6", () => make6(x)); attempt("M6", () => make6(x, x * 2)); attempt("u6", () => make6(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h6", () => make6(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o6", () => show(new (C6 as any)(v, v, v, v)) + effects); attempt("r6", () => show(Reflect.construct(C6 as any, [v], C6 as any))); attempt("s6", () => show(new (C6 as any)(...[v, 1]))); }
log.push("l6 " + C6.length + (C6 as any).prototype.sum.length);
function g6(x: number, y = 0, z?: number): any { const r = x % y; return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h6 = (x: number, y = -1): number => x < y ? x : y;
function k6(n: number, acc?: number): any { return n <= 0 ? acc : k6(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g6", () => [g6(x), g6(x, x), g6(x, undefined, x), g6(1.5, 2.5, 3.5), h6(x), h6(x, x / 2), h6(x, undefined), k6(x > 10 ? 3 : 2, x), k6(3)].map(show).join(";")); }
for (const v of odd) attempt("G6", () => [(g6 as any)(v, v, v), (h6 as any)(1, v), (g6 as any).call(null, 1, v), (h6 as any).apply(null, [v]), (g6 as any).bind(null, 2)(v)].map(show).join(";"));
class C7 {
  f0 = 7;
  f1: any;
  f2: number;
  constructor(private a0 = numbers[2]!, a1: any) {
    if (a0 === -1) throw new RangeError("no " + a0);
    this.f0 = a1 as any;
    this.f1 = () => this.constructor.name;
    this.f2 = effect(a0);
  }
  sum(x = -1, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
class D7 extends C7 { extra = 0.5; constructor(b0 = 1, b1?: number) { super(b0, b1 as any); (this as any).own = b1; } }
function make7(x: number, y?: number) { const o: any = new C7(1, undefined as any); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m7", () => make7(x)); attempt("M7", () => make7(x, x * 2)); attempt("u7", () => make7(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h7", () => make7(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o7", () => show(new (C7 as any)(v, v, v, v)) + effects); attempt("r7", () => show(Reflect.construct(C7 as any, [v], D7 as any))); attempt("s7", () => show(new (C7 as any)(...[v, 1]))); }
for (const x of numbers) { attempt("d7", () => show(new D7(x))); attempt("e7", () => show(new D7(undefined, x))); attempt("n7", () => show(new D7())); }
log.push("l7 " + C7.length + (C7 as any).prototype.sum.length);
function g7(x: number, y = 2147483648, z?: number): any { const r = x + y; return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h7 = (x: number, y = 2147483648): number => Math.sqrt(x * x + y * y);
function k7(n: number, acc?: number): any { return n <= 0 ? acc : k7(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g7", () => [g7(x), g7(x, x), g7(x, undefined, x), g7(1.5, 2.5, 3.5), h7(x), h7(x, x / 2), h7(x, undefined), k7(x > 10 ? 3 : 2, x), k7(3)].map(show).join(";")); }
for (const v of odd) attempt("G7", () => [(g7 as any)(v, v, v), (h7 as any)(1, v), (g7 as any).call(null, 1, v), (h7 as any).apply(null, [v]), (g7 as any).bind(null, 2)(v)].map(show).join(";"));
class C8 {
  f0 = false;
  f1 = "s";
  constructor(public a0: any, readonly a1: number = 1, a2: number = 1, a3: number = effect(-0)) {
    this.f0 = a1 as any > 1;
  }
  sum(x = -0, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
function make8(x: number, y?: number) { const o: any = new C8(x | 0, x, 2147483648); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m8", () => make8(x)); attempt("M8", () => make8(x, x * 2)); attempt("u8", () => make8(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h8", () => make8(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o8", () => show(new (C8 as any)(v, v, v, v)) + effects); attempt("r8", () => show(Reflect.construct(C8 as any, [v], C8 as any))); attempt("s8", () => show(new (C8 as any)(...[v, 1]))); }
log.push("l8 " + C8.length + (C8 as any).prototype.sum.length);
function g8(x: number, y = -1, z?: number): any { const r = x < y ? 1 : 2; return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h8 = (x: number, y = x + 1): number => x < y ? x : y;
function k8(n: number, acc?: number): any { return n <= 0 ? acc : k8(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g8", () => [g8(x), g8(x, x), g8(x, undefined, x), g8(1.5, 2.5, 3.5), h8(x), h8(x, x / 2), h8(x, undefined), k8(x > 10 ? 3 : 2, x), k8(3)].map(show).join(";")); }
for (const v of odd) attempt("G8", () => [(g8 as any)(v, v, v), (h8 as any)(1, v), (g8 as any).call(null, 1, v), (h8 as any).apply(null, [v]), (g8 as any).bind(null, 2)(v)].map(show).join(";"));
class K9 {
  f0 = "s9";
  #f1 = NaN;
  f2 = "s9";
  f3 = 1;
  f4 = false;
  constructor(public a0 = NaN, a1?: number, a2?: number) {
    const t = a0 * 2 + 0.5;
    if ((a1 ?? 7) > 1e200) throw new RangeError("large");
    this.#f1 = a0;
    this.f4 = (a1 ?? -0) > 1;
  }
  get pf1(): number { return this.#f1; }
  total(): number { return this.a0 + this.f3 + this.pf1; }
}
function loop9(m: number): string {
  const list: K9[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K9(i - 0.5); const two = i & 1 ? new K9(sum - 0.5, sum / 3, sum * 0.25) : new K9(3, i / 3, i / 3); list.push(one, two); sum += one.total(); if (i & 4) list.push(new K9(m)); }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k9", () => loop9(m));
for (const v of odd) attempt("j9", () => { const o: any = new (K9 as any)(v, v); return show(o) + Object.getOwnPropertyNames(o).join(); });
class C10 {
  constructor(private a0 = NaN, a1?: number, a2 = 1, a3: number = 3) {
    if (a0 === -1) throw new RangeError("no " + a0);
  }
  sum(x = 3, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
function make10(x: number, y?: number) { const o: any = new C10(y as any); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m10", () => make10(x)); attempt("M10", () => make10(x, x * 2)); attempt("u10", () => make10(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h10", () => make10(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o10", () => show(new (C10 as any)(v, v, v, v)) + effects); attempt("r10", () => show(Reflect.construct(C10 as any, [v], C10 as any))); attempt("s10", () => show(new (C10 as any)(...[v, 1]))); }
log.push("l10 " + C10.length + (C10 as any).prototype.sum.length);
function g10(x: number, y = 0.5, z?: number): any { const r = x * y; return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h10 = (x: number, y = effect(3)): number => x + y;
function k10(n: number, acc?: number): any { return n <= 0 ? acc : k10(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g10", () => [g10(x), g10(x, x), g10(x, undefined, x), g10(1.5, 2.5, 3.5), h10(x), h10(x, x / 2), h10(x, undefined), k10(x > 10 ? 3 : 2, x), k10(3)].map(show).join(";")); }
for (const v of odd) attempt("G10", () => [(g10 as any)(v, v, v), (h10 as any)(1, v), (g10 as any).call(null, 1, v), (h10 as any).apply(null, [v]), (g10 as any).bind(null, 2)(v)].map(show).join(";"));
class K11 {
  f0: number[] = [0.5];
  f1: number;
  f2: number;
  constructor(public a0: number, public a1: number) {
    this.f1 = a1;
    this.f2 = a1;
  }
  total(): number { return this.a0 + this.a1 + this.f1 + this.f2; }
}
function loop11(m: number): string {
  const list: K11[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K11(1, i * 0.25); const two = i & 1 ? new K11(-1, sum * 0.25) : new K11(i * 0.25, i - 0.5); list.push(one, two); sum += one.total(); if (i & 4) list.push(new K11(m * 0.25, m)); }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k11", () => loop11(m));
class C12 {
  f0 = "s";
  f1 = "s";
  f2: number;
  constructor(a0: number = 2147483648, public a1?: number) {
    if (a0 === -1) throw new RangeError("no " + a0);
    this.f2 = a0 as any;
  }
  sum(x = 7, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
class D12 extends C12 { extra = 1e21; constructor(b0 = 0, b1?: number) { super(0.5, NaN); (this as any).own = b1; } }
function make12(x: number, y?: number) { const o: any = new C12(); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m12", () => make12(x)); attempt("M12", () => make12(x, x * 2)); attempt("u12", () => make12(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h12", () => make12(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o12", () => show(new (C12 as any)(v, v, v, v)) + effects); attempt("r12", () => show(Reflect.construct(C12 as any, [v], D12 as any))); attempt("s12", () => show(new (C12 as any)(...[v, 1]))); }
for (const x of numbers) { attempt("d12", () => show(new D12(x))); attempt("e12", () => show(new D12(undefined, x))); attempt("n12", () => show(new D12())); }
log.push("l12 " + C12.length + (C12 as any).prototype.sum.length);
function g12(x: number, y = 7, z?: number): any { const r = x | y; return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h12 = (x: number, y = -0): number => x + y;
function k12(n: number, acc?: number): any { return n <= 0 ? acc : k12(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g12", () => [g12(x), g12(x, x), g12(x, undefined, x), g12(1.5, 2.5, 3.5), h12(x), h12(x, x / 2), h12(x, undefined), k12(x > 10 ? 3 : 2, x), k12(3)].map(show).join(";")); }
for (const v of odd) attempt("G12", () => [(g12 as any)(v, v, v), (h12 as any)(1, v), (g12 as any).call(null, 1, v), (h12 as any).apply(null, [v]), (g12 as any).bind(null, 2)(v)].map(show).join(";"));
class C13 {
  f0 = -0;
  f1 = "s";
  f2 = () => this;
  f3 = effect(3);
  constructor(private a0 = numbers.length, a1: number = -1, readonly a2?: number, a3 = 7) {
    this.f0 = a1 as any;
    if (a0 === 7) return { other: a0 } as any;
  }
  sum(x = 2147483648, y?: number) { return [x, y, y === undefined ? x : x + y]; }
}
function make13(x: number, y?: number) { const o: any = new C13(y as any, x | 0, x / 3, undefined as any); return show(o) + "" + Object.getOwnPropertyNames(o).join() + show(o.sum()) + show(o.sum(x)) + show(o.sum(x, y)) + show(o.sum(undefined, x)); }
for (const x of numbers) { attempt("m13", () => make13(x)); attempt("M13", () => make13(x, x * 2)); attempt("u13", () => make13(x, undefined)); }
for (let i = 0; i < holes.length; i++) attempt("h13", () => make13(holes[i]!, holes[4 - i]));
for (const v of odd) { attempt("o13", () => show(new (C13 as any)(v, v, v, v)) + effects); attempt("r13", () => show(Reflect.construct(C13 as any, [v], C13 as any))); attempt("s13", () => show(new (C13 as any)(...[v, 1]))); }
log.push("l13 " + C13.length + (C13 as any).prototype.sum.length);
function g13(x: number, y = 3, z?: number): any { const r = x - y; return z === undefined ? r : z > r ? z : [r, z, typeof z]; }
const h13 = (x: number, y = effect(1)): number => y;
function k13(n: number, acc?: number): any { return n <= 0 ? acc : k13(n - 1, (acc ?? 0.5) * 1.5); }
for (const x of numbers) { attempt("g13", () => [g13(x), g13(x, x), g13(x, undefined, x), g13(1.5, 2.5, 3.5), h13(x), h13(x, x / 2), h13(x, undefined), k13(x > 10 ? 3 : 2, x), k13(3)].map(show).join(";")); }
for (const v of odd) attempt("G13", () => [(g13 as any)(v, v, v), (h13 as any)(1, v), (g13 as any).call(null, 1, v), (h13 as any).apply(null, [v]), (g13 as any).bind(null, 2)(v)].map(show).join(";"));
class K14 {
  f0: K14 | null = null;
  f1 = 7;
  f2 = 3;
  f3: number[] = [];
  constructor(readonly a0?: number) {
  }
  total(): number { return (this.a0 ?? 0) + this.f1 + this.f2; }
}
function loop14(m: number): string {
  const list: K14[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K14(); const two = i & 1 ? new K14() : new K14(i / 3); list.push(one, two); sum += one.total();  }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k14", () => loop14(m));
for (const v of odd) attempt("j14", () => { const o: any = new (K14 as any)(v, v); return show(o) + Object.getOwnPropertyNames(o).join(); });
class K15 {
  f0: number;
  f1: number[] = [1, 2];
  f2: number[] = [];
  f3 = "s15";
  f4 = false;
  f5 = "s15";
  constructor(public a0 = NaN, readonly a1 = 2147483648, public a2 = 2147483648) {
    const t = a0 * 2 + 1;
    this.f0 = a1 > 1 ? a0 : -0;
    this.f2 = [a0, a0];
    this.f4 = a1 > 1;
  }
  total(): number { return this.a0 + this.a1 + this.a2 + this.f0; }
}
function loop15(m: number): string {
  const list: K15[] = []; let sum = 0;
  for (let i = 0; i < m; i++) { const one = new K15(i * 0.25, i - 0.5); const two = i & 1 ? new K15(1) : new K15(i, i - 0.5); list.push(one, two); sum += one.total(); if (i & 4) list.push(new K15(m, m / 3)); }
  let text = ""; for (const one of list) text += show(one) + Object.keys(one).length + ("f0" in one) + Object.getOwnPropertyNames(one).join() + JSON.stringify(one, (k, v) => k && typeof v === "object" && v !== null && !Array.isArray(v) ? "o" : v) + show(one.total());
  return text + show(sum);
}
for (const m of [0, 1, 2, 7, 23]) attempt("k15", () => loop15(m));
for (const v of odd) attempt("j15", () => { const o: any = new (K15 as any)(v, v); return show(o) + Object.getOwnPropertyNames(o).join(); });
console.log(log.length + " " + effects);
let digest = 0; for (const line of log) for (let i = 0; i < line.length; i++) digest = (digest * 31 + line.charCodeAt(i)) | 0;
console.log(digest);
console.log(process.argv[2] === "all" ? log.join("\n") : log.filter((_, i) => i % 61 === 0).join("\n"));
