// Iterations that have a class object made by what they read: its static fields move out of their variables there, behind the question in front of the loop.
let g: any = null;
const h: any = JSON.parse("{}");
const list: any[] = [1, 2, 3, 4];
const K: number = JSON.parse("5");
class S0 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function f0(k: any): any { let n: any = 0; let i = k; do { const x: any = i; S0.v = i; if (i === 3) g = S0.m;  i--; } while (i > 0); return n; }
console.log("method", f0(5), S0.v, S0.w);
class S1 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function f1(k: any): any { let n: any = 0; let i = k; do { const x: any = i; S1.v = i; g = S1.later; n += S1.v; i--; } while (i > 0); return n; }
console.log("later", f1(5), S1.v, S1.w);
class S2 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function f2(k: any): any { let n: any = 0; let i = k; do { const x: any = i;  g = S2.m ?? S2.later; S2.v = i; i--; } while (i > 0); return n; }
console.log("or", f2(5), S2.v, S2.w);
class S3 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function f3(k: any): any { let n: any = 0; let i = k; do { const x: any = i; S3.v = i; g = { m: S3.m }; S3.v = x; i--; } while (i > 0); return n; }
console.log("object", f3(5), S3.v, S3.w);
class S4 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function f4(k: any): any { let n: any = 0; let i = k; do { const x: any = i; S4.v = i; const { m } = S4; g = m; n += S4.v; i--; } while (i > 0); return n; }
console.log("destructure", f4(5), S4.v, S4.w);
class S5 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function f5(k: any): any { let n: any = 0; let i = K; while (true) { const x = list[i & 3]; if (i === 2) { i--; continue; } S5.v = i; g = S5?.m;  if (--i < 1) break; } return n; }
console.log("optional", f5(5), S5.v, S5.w);
class S6 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } static *[Symbol.iterator](): any { yield 1; } }
function f6(k: any): any { let n: any = 0; let i = k; do { const x: any = i; S6.v = i; g = S6[Symbol.iterator]; n += S6.v; i--; } while (i > 0); return n; }
console.log("symbol", f6(5), S6.v, S6.w);
class S7 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function f7(k: any): any { let n: any = 0; let i = K; while (true) { const x = list[i & 3]; if (i === 2) { i--; continue; }  g = i & 1 ? S7.m : S7.later; S7.v = i; if (--i < 1) break; } return n; }
console.log("choice", f7(5), S7.v, S7.w);
class S8 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function f8(k: any): any { let n: any = 0; let i = k; do { const x: any = i; S8.v = i; list.push(S8.m);  i--; } while (i > 0); return n; }
console.log("pushed", f8(5), S8.v, S8.w);
class S9 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function f9(k: any): any { let n: any = 0; let i = k; do { const x: any = i; S9.v = i; try { throw S9.m; } catch (e) { g = e; }  i--; } while (i > 0); return n; }
console.log("thrown", f9(5), S9.v, S9.w);
class S10 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function helper10(): any { return S10.m; }
function f10(k: any): any { let n: any = 0; let i = k; do { const x: any = i; S10.v = i; g = helper10();  i--; } while (i > 0); return n; }
console.log("helper", f10(5), S10.v, S10.w);
class S11 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
class B11 extends S11 {}
function f11(k: any): any { let n: any = 0; let i = k; do { const x: any = i;  if (i === 3) g = B11.m; S11.v = i; i--; } while (i > 0); return n; }
console.log("heir", f11(5), S11.v, S11.w);
class S12 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function f12(k: any): any { let n: any = 0; let i = k; do { const x: any = i; S12.v++; if (i === 3) g = S12.m.name; n += S12.v; i--; } while (i > 0); return n; }
console.log("its name", f12(5), S12.v, S12.w);
class S13 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function f13(k: any): any { let n: any = 0; let i = K; while (true) { const x = list[i & 3]; if (i === 2) { i--; continue; } n += ++S13.v; h.m = S13.m; n += S13.v--; S13.v += 2; if (--i < 1) break; } return n; }
console.log("field", f13(5), S13.v, S13.w);
class S14 { static v: any = 7; static w: any = 2; static m(): any { return 5; } static later(): number { return 2; } }
function f14(k: any): any { let n: any = 0; for (let j = 0; j < 2; j++) { for (let i = K; i > 0; i--) { const x: any = i; n += ++S14.v; if (i === 3) g = S14.m; n += S14.v--; S14.v += 2; } n += j; } return n; }
console.log("nested", f14(5), S14.v, S14.w);
console.log(typeof g, list.length, typeof h.m);
export {};
