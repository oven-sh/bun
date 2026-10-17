// A function that branches on the length of an array literal it was passed.
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
// Typed, the same shapes.
function leak(a: unknown[]): number { m.kept.push(a); a.push("leaked"); return a.length; }
function pick(f: (...r: number[]) => number, ...args: number[]): number { switch (args.length) { case 0: return f(); case 1: return f(args[0]); case 2: return f(args[0], args[1]); default: return f.apply(undefined, args); } }
function sum(...r: number[]): number { let s = 0; for (const x of r) s += x; return s * 10 + r.length; }
function typedLiterals(x: number, y: number): string { const out: unknown[] = []; { const a = [x]; if (a.length === 2) leak(a); out.push(a[0], a.length); } { const a = [x, y]; if (a.length === 2) leak(a); out.push(a[0], a.length); } { const a: number[] = [x, y, x]; let s = 0; for (let i = 0; i < 3; i++) { if (a.length > 3) s += leak(a); else s += a[i]; } out.push(s, a.length); } return out.join(); }
for (let round = 0; round < 3; round++) {
  console.log(m.callers());
  console.log(m.literals(1, 2), m.literals("a", 1), m.literals(2, 2));
  console.log(pick(sum), pick(sum, 1), pick(sum, 1, 2), pick(sum, 1, 2, 3), pick(sum, 1, 2, 3, 4, 5, 6, 7, 8, 9), typedLiterals(1, 2), m.kept.length, JSON.stringify(m.kept[m.kept.length - 1]));
}
export {};
