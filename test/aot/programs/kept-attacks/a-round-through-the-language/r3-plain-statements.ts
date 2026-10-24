// A round through the language: plain statements. It prints what plain Bun prints.
type P = { x: number; y: string };
function same(n: number): number { return n; }
function plus(n: number): number { return n + 1; }
function text(s: string): string { return s; }
function pick(p: P): number { return p.x; }
function viaCall(n: number): number { return same(n); }
function viaField(n: number): number { const o = { v: n }; return o.v; }
function viaArray(n: number): number { const a = [n]; return a[0]; }
function times(n: number, m: number): number { return n * m; }
function typedUser(n: number): string { const a = same(n) + plus(n) + viaCall(n) + times(n, 2); return "t" + (a * 2); }
function mixedUser(v: any): string { const a = same(v); const b = plus(v); const c = times(v, v); return typeof a + typeof b + typeof c + (a + b) + c; }
const A: any = { same, plus, text, pick, viaCall, viaField, viaArray, times, typedUser };
const r1 = A.same("s"); console.log("same", typeof r1, r1);
const r2 = A.plus("s"); console.log("plus", typeof r2, r2);
const r3 = A.text(42); console.log("text", typeof r3, r3 + 1);
const r4 = A.pick({ x: "px" }); console.log("pick", typeof r4, r4);
const r5 = A.viaCall("c"); console.log("viaCall", typeof r5, r5);
const r6 = A.viaField("f"); console.log("viaField", typeof r6, r6);
const r7 = A.viaArray("a"); console.log("viaArray", typeof r7, r7);
const r8 = A.times(3n, 4n); console.log("times", typeof r8, String(r8));
const r9 = A.times("3", "4"); console.log("times-str", typeof r9, r9);
console.log("typedUser", typedUser(1), A.typedUser("1"));
console.log("mixedUser", mixedUser(2), mixedUser("2"));
console.log("same-math", A.same("7") * 2, A.same({ valueOf() { return 4; } }) * 2);
