// Arrays with literal element types such as `(0 | 1)[]` are assigned, passed and stored through wider array types. A 7 stored through `number[]` into an array written or inferred `1[]` is read as it is: a literal type promises the kind, number.
declare const console: { log(...a: unknown[]): void };
function row(name: string, f: () => unknown): void { let got: unknown; try { got = f(); } catch (e) { got = "threw " + (e as Error).name; } console.log(name + ": " + got); }
function w1() { const a: (0 | 1)[] = [0, 1]; const b: (0 | 1)[] = a; return b[0] + b[1]; }
row("a written array of literals into a place written the same", () => w1());
function takes(p: (0 | 1)[]) { return p[1]; }
function w2() { const a: (0 | 1)[] = [0, 1]; return takes(a); }
row("the same as a parameter", () => w2());
class H { f: (0 | 1)[] = [0, 1]; }
function w3() { const h = new H(); const a: (0 | 1)[] = h.f; h.f = a; return h.f[1]; }
row("the same as a field of a class", () => w3());
function w4(k: number) { switch (k) { case 1: { const a = [k]; const n: number[] = a; n[0] = 7; return a[0]; } } }
row("stored through number[], an inferred 1[]", () => w4(1));
function w5() { const a: 1[] = [1]; const n: number[] = a; n[0] = 7; return a[0]; }
row("stored through number[], a written 1[]", () => w5());
interface Box<T> { kind: 1 | 2; value: T }
function w6(b: Box<string>) { return b.kind === 1 ? "one" + b.value : "two" + b.value; }
row("a written kind on a generic interface", () => w6({ kind: 1, value: "a" }) + w6({ kind: 2, value: "b" }));
class M { cmp(x: number) { return x < 0 ? -1 : x > 0 ? 1 : 0; } }
function w7() { const m = new M(); const s = m.cmp(5); return s === 1 ? "up" : s === -1 ? "down" : "flat"; }
row("a method whose result is inferred literals", () => w7());
function make(kind: 1 | 2) { if (kind === 1) return { kind, a: 1 }; return { kind, b: 2 }; }
function w8() { const r = make(1); const s = make(2); return (r.kind === 1 ? r.a : r.b) + (s.kind === 1 ? s.a : s.b); }
row("a union told apart by a narrowed kind", () => w8());
function w9(k: number) { switch (k) { case 1: { const m = new Map([["a", [k]]]); m.get("a")![0]++; return m.get("a")![0]; } } }
row("an array in a Map", () => w9(1));
function w11(k: number) { switch (k) { case 1: { const a = [k]; a[0]++; const [[, x]] = [...a.entries()]; return x; } } }
row("entries() spread and taken apart", () => w11(1));
type Bx<T> = { value: T };
function takesBox(b: Bx<1>) { return b.value; }
function w12(k: number) { switch (k) { case 1: { const b: Bx<1> = { value: k }; return takesBox(b); } } }
row("a Bx<1> made by a literal, kept in a const, handed to a parameter written Bx<1>", () => w12(1));
class HB { f: Bx<1> = { value: 1 }; }
function w13() { const h = new HB(); const b = h.f; h.f = b; return h.f.value; }
row("the same as a field", () => w13());
