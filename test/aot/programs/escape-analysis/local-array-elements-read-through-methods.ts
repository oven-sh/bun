// Elements of a local array are read through generic functions and array methods (`shift`, `find`, `concat`, `Array.from`, iterators).
declare const console: { log(...a: unknown[]): void };
function row(name: string, f: () => unknown): void { let got: unknown; try { got = f(); } catch (e) { got = "threw " + (e as Error).name + " " + (e as Error).message; } console.log(name + ": " + got); }
function firstOf<T>(xs: T[]): T { return xs[0]; }
function g1(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return firstOf(a); } } }
row("through a generic function of the program", () => g1(1));
function g2(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.shift(); } } }
row("shift", () => g2(1));
function g3(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.find(() => true); } } }
row("find", () => g3(1));
function g4(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.concat()[0]; } } }
row("concat", () => g4(1));
function g5(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return Array.from(a)[0]; } } }
row("Array.from", () => g5(1));
function g6(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.values().next().value; } } }
row("values().next()", () => g6(1));
function g7(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; let s = 0; for (const [, x] of a.entries()) s += x; return s; } } }
row("entries()", () => g7(1));
function g8(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; const x = a[0]; return x + 1; } } }
row("kept in a const, then used", () => g8(1));
function g9(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; return a.filter(x => x > 0).length + a.lastIndexOf(k); } } }
row("filter and lastIndexOf", () => g9(1));
function sign(x: number) { return x < 0 ? -1 : x > 0 ? 1 : 0; }
function g10(x: number) { const s = sign(x); return s === 1 ? "up" : s === -1 ? "down" : "flat"; }
row("an inferred result of literals is as it was", () => g10(5) + g10(-5) + g10(0));
type S = { kind: 1; a: number } | { kind: 2; b: string };
function g11(all: S[]) { let t = ""; for (const s of all) t += s.kind === 1 ? s.a : s.b; return t; }
row("a union told apart by a number, out of an array", () => g11([{ kind: 1, a: 5 }, { kind: 2, b: "z" }]));
function g12() { const t = [1, 2] as const; return t[0] + t[1]; }
row("as const", () => g12());
