// Callbacks whose return type is inferred from context (generic parameters, `Array.map`, `sort`) return elements of local arrays.
declare const console: { log(...a: unknown[]): void };
function row(name: string, f: () => unknown): void { let got: unknown; try { got = f(); } catch (e) { got = "threw " + (e as Error).name + " " + (e as Error).message; } console.log(name + ": " + got); }
function apply<R>(f: () => R): R { return f(); }
function both<R>(f: () => R, g: () => R): R[] { return [f(), g()]; }
function r1(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return apply(() => a[0]); } } }
row("a callback's result put in for a type parameter", () => r1(1));
function r2(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return [0].map(() => a[0])[0]; } } }
row("the same through Array.map", () => r2(1));
function r3(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return both(() => a[0], () => a[0] + 1).join(); } } }
row("two callbacks for one parameter", () => r3(1));
const written: () => 1 | 2 = () => 1;
row("a written result of literals", () => (written() === 1 ? "one" : "two"));
type Kinded = { kind: 1; a: string } | { kind: 2; b: number };
const make: (k: boolean) => Kinded = k => (k ? { kind: 1, a: "x" } : { kind: 2, b: 7 });
row("a written union told apart by a kind, made by a callback", () => { const v = make(true), w = make(false); return (v.kind === 1 ? v.a : v.b) + "" + (w.kind === 1 ? w.a : w.b); });
row("the same put in for a type parameter", () => { const v = apply((): Kinded => ({ kind: 2, b: 9 })); return v.kind === 2 ? v.b : v.a; });
row("sort's comparer", () => [3, 1, 2].sort((x, y) => (x < y ? -1 : x > y ? 1 : 0)).join());
const sign = (x: number) => (x < 0 ? -1 : x > 0 ? 1 : 0);
row("an inferred result of literals of an arrow", () => (sign(5) === 1 ? "up" : "other"));
function r5(k: 1 | 2) { const x: 1 | 2 = (() => k)(); return x === 1 ? "one" : "two"; }
row("an arrow called where it is written, under a written 1 | 2", () => r5(1) + r5(2));
function r6(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; const x: number = (() => a[0])(); return x; } } }
row("the same with the hole, under number", () => r6(1));
function r7(k: number) { switch (k) { case 1: { const a = [k]; const x: 1 | 2 = (() => a[0])(); return x === 1 ? "one" : "two"; } } }
row("the same out of an array, under a written 1 | 2", () => r7(1));
const list: () => (1 | 2)[] = () => [1, 2];
row("a written result that is an array of literals", () => list()[0] + list()[1] + (list()[0] === 1 ? "one" : "other"));
function r4(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return Promise.resolve(a).then(x => x[0]); } } }
r4(1)!.then(v => console.log("out of a Promise: " + v), e => console.log("out of a Promise: rejected " + (e as Error).message));
