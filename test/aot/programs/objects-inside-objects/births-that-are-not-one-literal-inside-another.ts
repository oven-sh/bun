// Births that are not one literal inside another: a shared inner object, stores between the births, a factory, a loop, either arm, two inner objects, nesting, an optional field.
interface Inner { d: number; e: number }
interface A { b: number; c: Inner }
function shared(): number { const inner: Inner = { d: 1, e: 2 }; const x: A = { b: 1, c: inner }; const y: A = { b: 2, c: inner }; x.c.d = 5; return y.c.d; }
console.log(shared());
interface B { b: number; c: Inner }
function storedBetween(flag: boolean): number { const inner: Inner = { d: 1, e: 2 }; if (flag) inner.d = 7; const x: B = { b: 1, c: inner }; inner.e = 9; return x.c.d + x.c.e; }
console.log(storedBetween(true), storedBetween(false));
interface C { b: number; c: Inner }
function factory(i: number): Inner { return { d: i, e: i }; }
function fromFactory(i: number): number { const x: C = { b: i, c: factory(i) }; x.c.d += 1; return x.c.d; }
console.log(fromFactory(3));
interface D { b: number; c: Inner }
function inLoop(): number { const inner: Inner = { d: 0, e: 0 }; let last: D | null = null; for (let i = 0; i < 3; i++) { last = { b: i, c: inner }; last.c.d += 1; } return last!.c.d; }
console.log(inLoop());
interface E { b: number; c: Inner }
function eitherArm(flag: boolean): number { const x: E = flag ? { b: 1, c: { d: 1, e: 1 } } : { b: 2, c: { d: 2, e: 2 } }; x.c.e += x.c.d; return x.c.e; }
console.log(eitherArm(true), eitherArm(false));
interface F { b: number; c: Inner; c2: Inner }
function two(i: number): number { const x: F = { b: i, c: { d: i, e: 1 }, c2: { d: i * 10, e: 2 } }; x.c.d += x.c2.d; x.c2.e += x.c.e; return x.c.d * 100 + x.c2.e; }
console.log(two(2));
interface Leaf { v: number }
interface Mid { leaf: Leaf; w: number }
interface Top { mid: Mid; u: number }
function nested(i: number): number { const x: Top = { mid: { leaf: { v: i }, w: i + 1 }, u: i + 2 }; x.mid.leaf.v += x.mid.w; return x.mid.leaf.v + x.u; }
console.log(nested(1));
interface Opt { d: number; e?: number }
interface G { c: Opt }
function optional(i: number): string { const x: G = { c: { d: i } }; const before = x.c.e; x.c.e = i; return before + ":" + x.c.e; }
console.log(optional(4));
