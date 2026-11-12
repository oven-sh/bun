// @ts-nocheck
// A list made by a spread is stored inside, at, past and far past its end in while, for and do loops, out of lists of every storage, views of every kind and iterables.
const A: any = { ints: () => [5, 2, 300, 4, 5, 6, 7, 8], doubles: () => [1.5, 200.5, 3.25, -0, 7.5, 8.5], whole: () => [1e9, 2e9, 3e9, 4e9], mixed: () => [1, 2.5, "x", 200], holes: () => [1, , 300, 4], i8: () => new Int8Array([1, 2, 3, 4]), u8: () => new Uint8Array([1, 200, 3, 4]), u8c: () => new Uint8ClampedArray([1, 200, 3]), i16: () => new Int16Array([1, 2000, 3]), u16: () => new Uint16Array([1, 60000, 3]), i32: () => new Int32Array([1, 2e9, 3, -4, 5, 6, 7, 8]), u32: () => new Uint32Array([1, 4e9, 3, 4]), f32: () => new Float32Array([1.5, 200.25, 3]), f64: () => new Float64Array([1.5, 2 ** 31, 3.5, 400]), bytes: () => Buffer.from([1, 200, 3]), set: () => new Set([1, 2.5, 300]), text: () => "abc", frozen: () => Object.freeze([1, 2.5, 300]), empty: () => [] };
const one = (v: any) => typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : v === undefined ? "u" : typeof v === "object" ? "{}" : String(v); const show = (w: any) => { let s = w.length + "["; for (let i = 0; i < Math.min(w.length, 40); i++) s += (i in w ? one(w[i]) : "hole") + ","; return s + "]"; };
function f0(a: number[], b: number[], n: any): any { const w: any = [...b]; let i = w.length; while (i < n) { w[i] = a[i >> 1]; i++; } return w; }
function f1(a: number[], b: number[], n: any): any { const w: any = [...b, 5]; let i = w.length; while (i < n) { const x = a[i & 3]; if (x > 100) w[i] = x; i++; } return w; }
function f2(a: number[], b: number[], n: any): any { const w: any = [0, ...b]; let i = w.length; while (i < n) { w[i + 1] = a[i & 3]; i++; } return w; }
function f3(a: number[], b: number[], n: any): any { const w: any = [...b]; for (let i = w.length; i < n; i++) { w[i] = a[i >> 1]; } return w; }
function f4(a: number[], b: number[], n: any): any { const w: any = [...b, 5]; for (let i = w.length; i < n; i++) { const x = a[i & 3]; if (x > 100) w[i] = x; } return w; }
function f5(a: number[], b: number[], n: any): any { const w: any = [0, ...b]; for (let i = w.length; i < n; i++) { w[i + 1] = a[i & 3]; } return w; }
function f6(a: number[], b: number[], n: any): any { const w: any = [...b]; let i = w.length; do { w[i] = a[i >> 1]; i++; } while (i < n); return w; }
function f7(a: number[], b: number[], n: any): any { const w: any = [...b, 5]; let i = w.length; do { const x = a[i & 3]; if (x > 100) w[i] = x; i++; } while (i < n); return w; }
function f8(a: number[], b: number[], n: any): any { const w: any = [0, ...b]; let i = w.length; do { w[i + 1] = a[i & 3]; i++; } while (i < n); return w; }
function f9(a: number[], b: number[], n: any): any { const w: any = [...b]; let i = w.length + 2; while (i < n) { w[i] = a[i >> 1]; i++; } return w; }
function f10(a: number[], b: number[], n: any): any { const w: any = [...b, 5]; let i = w.length + 2; while (i < n) { const x = a[i & 3]; if (x > 100) w[i] = x; i++; } return w; }
function f11(a: number[], b: number[], n: any): any { const w: any = [0, ...b]; let i = w.length + 2; while (i < n) { w[i + 1] = a[i & 3]; i++; } return w; }
function f12(a: number[], b: number[], n: any): any { const w: any = [...b]; for (let i = w.length + 2; i < n; i++) { w[i] = a[i >> 1]; } return w; }
function f13(a: number[], b: number[], n: any): any { const w: any = [...b, 5]; for (let i = w.length + 2; i < n; i++) { const x = a[i & 3]; if (x > 100) w[i] = x; } return w; }
function f14(a: number[], b: number[], n: any): any { const w: any = [0, ...b]; for (let i = w.length + 2; i < n; i++) { w[i + 1] = a[i & 3]; } return w; }
function f15(a: number[], b: number[], n: any): any { const w: any = [...b]; let i = w.length + 2; do { w[i] = a[i >> 1]; i++; } while (i < n); return w; }
function f16(a: number[], b: number[], n: any): any { const w: any = [...b, 5]; let i = w.length + 2; do { const x = a[i & 3]; if (x > 100) w[i] = x; i++; } while (i < n); return w; }
function f17(a: number[], b: number[], n: any): any { const w: any = [0, ...b]; let i = w.length + 2; do { w[i + 1] = a[i & 3]; i++; } while (i < n); return w; }
function f18(a: number[], b: number[], n: any): any { const w: any = [...b]; let i = w.length >> 1; while (i < n) { w[i] = a[i >> 1]; i++; } return w; }
function f19(a: number[], b: number[], n: any): any { const w: any = [...b, 5]; let i = w.length >> 1; while (i < n) { const x = a[i & 3]; if (x > 100) w[i] = x; i++; } return w; }
function f20(a: number[], b: number[], n: any): any { const w: any = [0, ...b]; let i = w.length >> 1; while (i < n) { w[i + 1] = a[i & 3]; i++; } return w; }
function f21(a: number[], b: number[], n: any): any { const w: any = [...b]; for (let i = w.length >> 1; i < n; i++) { w[i] = a[i >> 1]; } return w; }
function f22(a: number[], b: number[], n: any): any { const w: any = [...b, 5]; for (let i = w.length >> 1; i < n; i++) { const x = a[i & 3]; if (x > 100) w[i] = x; } return w; }
function f23(a: number[], b: number[], n: any): any { const w: any = [0, ...b]; for (let i = w.length >> 1; i < n; i++) { w[i + 1] = a[i & 3]; } return w; }
function f24(a: number[], b: number[], n: any): any { const w: any = [...b]; let i = w.length >> 1; do { w[i] = a[i >> 1]; i++; } while (i < n); return w; }
function f25(a: number[], b: number[], n: any): any { const w: any = [...b, 5]; let i = w.length >> 1; do { const x = a[i & 3]; if (x > 100) w[i] = x; i++; } while (i < n); return w; }
function f26(a: number[], b: number[], n: any): any { const w: any = [0, ...b]; let i = w.length >> 1; do { w[i + 1] = a[i & 3]; i++; } while (i < n); return w; }
function f27(a: number[], b: number[], n: any): any { const w: any = [...b]; let i = 0; while (i < n) { w[i] = a[i >> 1]; i++; } return w; }
function f28(a: number[], b: number[], n: any): any { const w: any = [...b, 5]; let i = 0; while (i < n) { const x = a[i & 3]; if (x > 100) w[i] = x; i++; } return w; }
function f29(a: number[], b: number[], n: any): any { const w: any = [0, ...b]; let i = 0; while (i < n) { w[i + 1] = a[i & 3]; i++; } return w; }
function f30(a: number[], b: number[], n: any): any { const w: any = [...b]; for (let i = 0; i < n; i++) { w[i] = a[i >> 1]; } return w; }
function f31(a: number[], b: number[], n: any): any { const w: any = [...b, 5]; for (let i = 0; i < n; i++) { const x = a[i & 3]; if (x > 100) w[i] = x; } return w; }
function f32(a: number[], b: number[], n: any): any { const w: any = [0, ...b]; for (let i = 0; i < n; i++) { w[i + 1] = a[i & 3]; } return w; }
function f33(a: number[], b: number[], n: any): any { const w: any = [...b]; let i = 0; do { w[i] = a[i >> 1]; i++; } while (i < n); return w; }
function f34(a: number[], b: number[], n: any): any { const w: any = [...b, 5]; let i = 0; do { const x = a[i & 3]; if (x > 100) w[i] = x; i++; } while (i < n); return w; }
function f35(a: number[], b: number[], n: any): any { const w: any = [0, ...b]; let i = 0; do { w[i + 1] = a[i & 3]; i++; } while (i < n); return w; }
const all: any[] = [f0, f1, f2, f3, f4, f5, f6, f7, f8, f9, f10, f11, f12, f13, f14, f15, f16, f17, f18, f19, f20, f21, f22, f23, f24, f25, f26, f27, f28, f29, f30, f31, f32, f33, f34, f35];
for (let k = 0; k < all.length; k++) for (const p in A) for (const q of ["ints", "doubles", "whole", "f64", "i32", "u8", "set", "text", "empty", "frozen", "mixed"]) { let r: any; try { r = show(all[k](A[p](), A[q](), k & 1 ? 8 : 32)); } catch (e: any) { r = "threw " + e?.constructor?.name; } console.log(k, p, q, r); }
console.log(f0(new Int32Array(8) as any, [1e9, 2e9], 32).length, f0([1e9, 2e9], new Float64Array([1.5, 2 ** 31]) as any, 8).length);
