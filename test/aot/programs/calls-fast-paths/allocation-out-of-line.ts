// The machine code for allocating objects, closures and small array literals is a short call to shared code.
declare const console: any;
interface P { a: number; b: number }
function fObj(a: number, b: number): P { return { a, b }; }
function fArr0(): number[] { return []; }
function fArr2(a: number, b: number): number[] { return [a, b]; }
function fArr4(a: number, b: number): number[] { return [a, b, a, b]; }
function fClo(a: number): () => number { return () => a; }
function fClo2(a: number, s: string): () => string { return () => s + a; }
function fEnv(a: number): () => number { let n = a; return () => ++n; }
const keep: any[] = [fObj, fArr0, fArr2, fArr4, fClo, fClo2, fEnv];
let s = 0;
for (let i = 0; i < 1_000_000; i++) { s += fObj(i, 1).a + fArr0().length + fArr2(i, 2)[0] + fArr4(i, 3)[3] + fClo(i)() + fClo2(i & 7, "x")().length + fEnv(i)(); }
console.log(s, keep.length);
export {};
