// A constructor that only stores to `this` is inlined however deep the call is nested, where the call is in a loop.
// IR= 0 top CallDirect
// IR= 1 topCounting CallDirect
declare const console: any;
interface Pt { x: number; y: number; tag: string | undefined }
function Pt(this: Pt, x: number, y: number) { this.x = x; this.y = y; this.tag = undefined; }
const PtConstructor = Pt as any as new (x: number, y: number) => Pt;
let made = 0;
interface Counted { x: number }
function Counted(this: Counted, x: number) { this.x = x; made++; }
const CountedConstructor = Counted as any as new (x: number) => Counted;
// The depth is 2: `top` takes in d1 and d2, and the call of the constructor in d2 stands at the limit.
function d2(a: number): Pt { return new PtConstructor(a, a + 1); }
function d1(a: number): Pt { return d2(a + 1); }
function top(a: number): Pt { let p: Pt | undefined; for (let k = 0; k < 2; k++) p = d1(a + 1); return p!; }
function c2(a: number): Counted { return new CountedConstructor(a); }
function c1(a: number): Counted { return c2(a + 1); }
function topCounting(a: number): Counted { let p: Counted | undefined; for (let k = 0; k < 2; k++) p = c1(a + 1); return p!; }
let s = 0; let last: Pt | undefined;
for (let i = 0; i < 3_000_000; i++) { const p = top(i & 7); s += p.x + p.y; last = p; }
for (let i = 0; i < 1000; i++) s += topCounting(i & 7).x;
// Called once outside any loop too: top-level code that runs once takes nothing in, so the function keeps a body for the expectations to look at.
s += top(1).x + topCounting(1).x;
console.log(s, made, Object.keys(last!).join(), last instanceof (Pt as any));
export {};
