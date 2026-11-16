// Derived classes of many sizes constructed through values: the prototype of each new target is remembered beside others, and an instance is copied whole.
class Root { constructor(k) { this.k = k; } get twice() { return this.k * 2; } size() { return 0; } }
class Middle extends Root { constructor(k, m) { super(k); if (m) this.m = m; } }
class C0 extends Root { constructor(k) { super(k);  } size() { return 0 + super.size(); } }
class C1 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f1_0 = k + 0.5; } size() { return 1 + super.size(); } }
class C2 extends Root { constructor(k) { super(k); this.f2_0 = "t0"; this.f2_1 = [k]; } size() { return 2 + super.size(); } }
class C3 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f3_0 = [k]; this.f3_1 = null; this.f3_2 = undefined; } size() { return 3 + super.size(); } }
class C4 extends Root { constructor(k) { super(k); this.f4_0 = null; this.f4_1 = undefined; this.f4_2 = -k; this.f4_3 = k; } size() { return 4 + super.size(); } }
class C5 extends C2 { constructor(k) { super(k); this.f5_0 = undefined; this.f5_1 = -k; this.f5_2 = k; this.f5_3 = k + 3.5; this.f5_4 = "t4"; } size() { return 5 + super.size(); } }
class C6 extends Root { constructor(k) { super(k); this.f6_0 = -k; this.f6_1 = k; this.f6_2 = k + 2.5; this.f6_3 = "t3"; this.f6_4 = [k]; this.f6_5 = null; } size() { return 6 + super.size(); } }
class C7 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f7_0 = k; this.f7_1 = k + 1.5; this.f7_2 = "t2"; this.f7_3 = [k]; this.f7_4 = null; this.f7_5 = undefined; this.f7_6 = -k; } size() { return 7 + super.size(); } }
class C8 extends Root { constructor(k) { super(k); this.f8_0 = k + 0.5; this.f8_1 = "t1"; this.f8_2 = [k]; this.f8_3 = null; this.f8_4 = undefined; this.f8_5 = -k; this.f8_6 = k; this.f8_7 = k + 7.5; } size() { return 8 + super.size(); } }
class C9 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f9_0 = "t0"; this.f9_1 = [k]; this.f9_2 = null; this.f9_3 = undefined; this.f9_4 = -k; this.f9_5 = k; this.f9_6 = k + 6.5; this.f9_7 = "t7"; this.f9_8 = [k]; } size() { return 9 + super.size(); } }
class C10 extends C7 { constructor(k) { super(k); this.f10_0 = [k]; this.f10_1 = null; this.f10_2 = undefined; this.f10_3 = -k; this.f10_4 = k; this.f10_5 = k + 5.5; this.f10_6 = "t6"; this.f10_7 = [k]; this.f10_8 = null; this.f10_9 = undefined; } size() { return 10 + super.size(); } }
class C11 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f11_0 = null; this.f11_1 = undefined; this.f11_2 = -k; this.f11_3 = k; this.f11_4 = k + 4.5; this.f11_5 = "t5"; this.f11_6 = [k]; this.f11_7 = null; this.f11_8 = undefined; this.f11_9 = -k; this.f11_10 = k; } size() { return 11 + super.size(); } }
class C12 extends Root { constructor(k) { super(k); this.f12_0 = undefined; this.f12_1 = -k; this.f12_2 = k; this.f12_3 = k + 3.5; this.f12_4 = "t4"; this.f12_5 = [k]; this.f12_6 = null; this.f12_7 = undefined; this.f12_8 = -k; this.f12_9 = k; this.f12_10 = k + 10.5; this.f12_11 = "t11"; } size() { return 12 + super.size(); } }
class C13 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined);  } size() { return 0 + super.size(); } }
class C14 extends Root { constructor(k) { super(k); this.f14_0 = k; } size() { return 1 + super.size(); } }
class C15 extends C12 { constructor(k) { super(k); this.f15_0 = k + 0.5; this.f15_1 = "t1"; } size() { return 2 + super.size(); } }
class C16 extends Root { constructor(k) { super(k); this.f16_0 = "t0"; this.f16_1 = [k]; this.f16_2 = null; } size() { return 3 + super.size(); } }
class C17 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f17_0 = [k]; this.f17_1 = null; this.f17_2 = undefined; this.f17_3 = -k; } size() { return 4 + super.size(); } }
class C18 extends Root { constructor(k) { super(k); this.f18_0 = null; this.f18_1 = undefined; this.f18_2 = -k; this.f18_3 = k; this.f18_4 = k + 4.5; } size() { return 5 + super.size(); } }
class C19 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f19_0 = undefined; this.f19_1 = -k; this.f19_2 = k; this.f19_3 = k + 3.5; this.f19_4 = "t4"; this.f19_5 = [k]; } size() { return 6 + super.size(); } }
class C20 extends C17 { constructor(k) { super(k); this.f20_0 = -k; this.f20_1 = k; this.f20_2 = k + 2.5; this.f20_3 = "t3"; this.f20_4 = [k]; this.f20_5 = null; this.f20_6 = undefined; } size() { return 7 + super.size(); } }
class C21 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f21_0 = k; this.f21_1 = k + 1.5; this.f21_2 = "t2"; this.f21_3 = [k]; this.f21_4 = null; this.f21_5 = undefined; this.f21_6 = -k; this.f21_7 = k; } size() { return 8 + super.size(); } }
class C22 extends Root { constructor(k) { super(k); this.f22_0 = k + 0.5; this.f22_1 = "t1"; this.f22_2 = [k]; this.f22_3 = null; this.f22_4 = undefined; this.f22_5 = -k; this.f22_6 = k; this.f22_7 = k + 7.5; this.f22_8 = "t8"; } size() { return 9 + super.size(); } }
class C23 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f23_0 = "t0"; this.f23_1 = [k]; this.f23_2 = null; this.f23_3 = undefined; this.f23_4 = -k; this.f23_5 = k; this.f23_6 = k + 6.5; this.f23_7 = "t7"; this.f23_8 = [k]; this.f23_9 = null; } size() { return 10 + super.size(); } }
class C24 extends Root { constructor(k) { super(k); this.f24_0 = [k]; this.f24_1 = null; this.f24_2 = undefined; this.f24_3 = -k; this.f24_4 = k; this.f24_5 = k + 5.5; this.f24_6 = "t6"; this.f24_7 = [k]; this.f24_8 = null; this.f24_9 = undefined; this.f24_10 = -k; } size() { return 11 + super.size(); } }
class C25 extends C22 { constructor(k) { super(k); this.f25_0 = null; this.f25_1 = undefined; this.f25_2 = -k; this.f25_3 = k; this.f25_4 = k + 4.5; this.f25_5 = "t5"; this.f25_6 = [k]; this.f25_7 = null; this.f25_8 = undefined; this.f25_9 = -k; this.f25_10 = k; this.f25_11 = k + 11.5; } size() { return 12 + super.size(); } }
class C26 extends Root { constructor(k) { super(k);  } size() { return 0 + super.size(); } }
class C27 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f27_0 = -k; } size() { return 1 + super.size(); } }
class C28 extends Root { constructor(k) { super(k); this.f28_0 = k; this.f28_1 = k + 1.5; } size() { return 2 + super.size(); } }
class C29 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f29_0 = k + 0.5; this.f29_1 = "t1"; this.f29_2 = [k]; } size() { return 3 + super.size(); } }
class C30 extends C27 { constructor(k) { super(k); this.f30_0 = "t0"; this.f30_1 = [k]; this.f30_2 = null; this.f30_3 = undefined; } size() { return 4 + super.size(); } }
class C31 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f31_0 = [k]; this.f31_1 = null; this.f31_2 = undefined; this.f31_3 = -k; this.f31_4 = k; } size() { return 5 + super.size(); } }
class C32 extends Root { constructor(k) { super(k); this.f32_0 = null; this.f32_1 = undefined; this.f32_2 = -k; this.f32_3 = k; this.f32_4 = k + 4.5; this.f32_5 = "t5"; } size() { return 6 + super.size(); } }
class C33 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f33_0 = undefined; this.f33_1 = -k; this.f33_2 = k; this.f33_3 = k + 3.5; this.f33_4 = "t4"; this.f33_5 = [k]; this.f33_6 = null; } size() { return 7 + super.size(); } }
class C34 extends Root { constructor(k) { super(k); this.f34_0 = -k; this.f34_1 = k; this.f34_2 = k + 2.5; this.f34_3 = "t3"; this.f34_4 = [k]; this.f34_5 = null; this.f34_6 = undefined; this.f34_7 = -k; } size() { return 8 + super.size(); } }
class C35 extends C32 { constructor(k) { super(k); this.f35_0 = k; this.f35_1 = k + 1.5; this.f35_2 = "t2"; this.f35_3 = [k]; this.f35_4 = null; this.f35_5 = undefined; this.f35_6 = -k; this.f35_7 = k; this.f35_8 = k + 8.5; } size() { return 9 + super.size(); } }
class C36 extends Root { constructor(k) { super(k); this.f36_0 = k + 0.5; this.f36_1 = "t1"; this.f36_2 = [k]; this.f36_3 = null; this.f36_4 = undefined; this.f36_5 = -k; this.f36_6 = k; this.f36_7 = k + 7.5; this.f36_8 = "t8"; this.f36_9 = [k]; } size() { return 10 + super.size(); } }
class C37 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f37_0 = "t0"; this.f37_1 = [k]; this.f37_2 = null; this.f37_3 = undefined; this.f37_4 = -k; this.f37_5 = k; this.f37_6 = k + 6.5; this.f37_7 = "t7"; this.f37_8 = [k]; this.f37_9 = null; this.f37_10 = undefined; } size() { return 11 + super.size(); } }
class C38 extends Root { constructor(k) { super(k); this.f38_0 = [k]; this.f38_1 = null; this.f38_2 = undefined; this.f38_3 = -k; this.f38_4 = k; this.f38_5 = k + 5.5; this.f38_6 = "t6"; this.f38_7 = [k]; this.f38_8 = null; this.f38_9 = undefined; this.f38_10 = -k; this.f38_11 = k; } size() { return 12 + super.size(); } }
class C39 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined);  } size() { return 0 + super.size(); } }
class C40 extends C37 { constructor(k) { super(k); this.f40_0 = undefined; } size() { return 1 + super.size(); } }
class C41 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f41_0 = -k; this.f41_1 = k; } size() { return 2 + super.size(); } }
class C42 extends Root { constructor(k) { super(k); this.f42_0 = k; this.f42_1 = k + 1.5; this.f42_2 = "t2"; } size() { return 3 + super.size(); } }
class C43 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f43_0 = k + 0.5; this.f43_1 = "t1"; this.f43_2 = [k]; this.f43_3 = null; } size() { return 4 + super.size(); } }
class C44 extends Root { constructor(k) { super(k); this.f44_0 = "t0"; this.f44_1 = [k]; this.f44_2 = null; this.f44_3 = undefined; this.f44_4 = -k; } size() { return 5 + super.size(); } }
class C45 extends C42 { constructor(k) { super(k); this.f45_0 = [k]; this.f45_1 = null; this.f45_2 = undefined; this.f45_3 = -k; this.f45_4 = k; this.f45_5 = k + 5.5; } size() { return 6 + super.size(); } }
class C46 extends Root { constructor(k) { super(k); this.f46_0 = null; this.f46_1 = undefined; this.f46_2 = -k; this.f46_3 = k; this.f46_4 = k + 4.5; this.f46_5 = "t5"; this.f46_6 = [k]; } size() { return 7 + super.size(); } }
class C47 extends Middle { constructor(k) { super(k, k & 1 ? "m" : undefined); this.f47_0 = undefined; this.f47_1 = -k; this.f47_2 = k; this.f47_3 = k + 3.5; this.f47_4 = "t4"; this.f47_5 = [k]; this.f47_6 = null; this.f47_7 = undefined; } size() { return 8 + super.size(); } }
const all = [C0, C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11, C12, C13, C14, C15, C16, C17, C18, C19, C20, C21, C22, C23, C24, C25, C26, C27, C28, C29, C30, C31, C32, C33, C34, C35, C36, C37, C38, C39, C40, C41, C42, C43, C44, C45, C46, C47];
globalThis.all = all;
function make(Target, k) { return new Target(k); }
function text(o) { return Object.keys(o).map(key => key + "=" + (Array.isArray(o[key]) ? "[" + o[key] + "]" : Object.is(o[key], -0) ? "-0" : String(o[key]))).join(","); }
let hash = 0;
const add = s => { for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0; };
const kept = [];
for (let round = 0; round < 60; round++) {
  for (let i = 0; i < globalThis.all.length; i++) {
    const o = make(globalThis.all[(i * 7 + round) % globalThis.all.length], round);
    if (round % 20 === 0) add(text(o) + o.size() + o.twice + (Object.getPrototypeOf(o) === globalThis.all[(i * 7 + round) % globalThis.all.length].prototype));
    if ((round * 48 + i) % 37 === 0) kept.push(o);
  }
  if (round % 25 === 24) Bun.gc(true);
}
console.log(hash, kept.length, kept.map(o => o.size() + o.twice).join());
function Plain(k) { this.k = k; this.seen = new.target === Plain; }
const before = new Plain(1);
Plain.prototype = { replaced: true };
console.log(before.replaced, make(Plain, 2).replaced, Reflect.construct(C7, [3], Plain).replaced, text(Reflect.construct(C7, [3], Plain)));
class Late extends C9 { }
console.log(text(make(Late, 4)), make(Late, 4) instanceof C9, Object.getPrototypeOf(make(Late, 5)) === Late.prototype);
const through = new Proxy(C11, {});
console.log(text(new through(6)), new through(6) instanceof C5, new through(6) instanceof C11);
const bound = C12.bind(null);
console.log(text(new bound(7)), new bound(7) instanceof C12, text(Reflect.construct(C13, [8], C14)), Reflect.construct(C13, [8], C14) instanceof C14);
Object.setPrototypeOf(C15, Middle);
console.log(text(make(C15, 9)), Object.getPrototypeOf(make(C15, 9)) === C15.prototype);
for (let round = 0; round < 3; round++) { hash = 0; for (let i = 0; i < 48; i++) add(text(make(globalThis.all[i], i))); console.log(hash); }
