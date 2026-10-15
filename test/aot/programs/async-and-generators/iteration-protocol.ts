// `for..of` and everything of the iterator protocol that a program can observe.
declare const console: { log(...v: unknown[]): void };
let log: string[] = []; const say = (s: string): void => { log.push(s); }; const flush = (title: string): void => { console.log(title + ": " + log.join(" ")); log = []; };
const kind = (e: unknown): string => (e as Error).constructor.name + ((e as Error).message.length < 12 ? "(" + (e as Error).message + ")" : "");
// The result is an object of a class with accessors: the order of the reads shows.
class Res { constructor(public v: number, public d: boolean, public bad: string) {} get done(): boolean { say("done"); if (this.bad === "done") throw new Error("done!"); return this.d; } get value(): number { say("value"); if (this.bad === "value") throw new Error("value!"); return this.v; } }
class Steps { i = 0; constructor(public n: number, public bad: string, public closing: string) {}
  next(): Res { say("next"); if (this.bad === "next" && this.i === 1) throw new Error("next!"); const at = this.i++; return new Res(at, at >= this.n, at === 1 ? this.bad : ""); }
  return(): { value: number, done: boolean } { say("return"); if (this.closing === "throws") throw new Error("return!"); if (this.closing === "no object") return 5 as any; return { value: 0, done: true }; } }
class Range { constructor(public n: number, public bad = "", public closing = "") {} [Symbol.iterator](): Steps { say("open"); return new Steps(this.n, this.bad, this.closing); } }
function whole(r: Range): number { let s = 0; for (const x of r) { say("body" + x); s += x; } return s; }
function broken(r: Range): number { let s = 0; for (const x of r) { say("body" + x); if (x === 1) break; s += x; } return s; }
function returned(r: Range): number { for (const x of r) { say("body" + x); if (x === 1) return 100 + x; } return -1; }
function thrown(r: Range): number { for (const x of r) { say("body" + x); if (x === 1) throw new Error("body!"); } return -1; }
function outer(r: Range, q: Range): number { let s = 0; again: for (const y of q) { for (const x of r) { say("body" + y + x); if (x === 1) continue again; s += x + y; } } return s; }
const attempt = (f: () => number): void => { try { say("=" + f()); } catch (e) { say("!" + kind(e)); } };
attempt(() => whole(new Range(2))); flush("whole");
attempt(() => whole(new Range(0))); flush("empty");
attempt(() => broken(new Range(3))); flush("break");
attempt(() => returned(new Range(3))); flush("return");
attempt(() => thrown(new Range(3))); flush("throw");
attempt(() => outer(new Range(3), new Range(2))); flush("continue outer");
for (const bad of ["next", "done", "value"]) { attempt(() => whole(new Range(3, bad))); flush(bad + " throws"); }
attempt(() => broken(new Range(3, "", "throws"))); flush("break, return throws");
attempt(() => thrown(new Range(3, "", "throws"))); flush("throw, return throws");
attempt(() => broken(new Range(3, "", "no object"))); flush("break, return yields no object");
attempt(() => thrown(new Range(3, "", "no object"))); flush("throw, return yields no object");
// No `return` method; `done` left out; an iterator that is its own iterable; a subclass that overrides; a union of two classes.
class Plain { i = 0; constructor(public n: number) {} next(): { value: number, done?: boolean } { if (this.i < this.n) return { value: this.i++ }; return { value: -1, done: true }; } [Symbol.iterator](): Plain { return this; } }
class Twice extends Plain { next(): { value: number, done?: boolean } { const r = super.next(); if (r.done) return r; return { value: r.value * 2 }; } }
function sum(p: Plain): number { let s = 0; for (const x of p) { if (x > 50) break; s += x; } return s; }
function either(p: Plain | Range): number { let s = 0; for (const x of p) s += x; return s; }
console.log("plain", sum(new Plain(4)), sum(new Twice(4)), sum(new Plain(0)), either(new Plain(3))); log = []; console.log("either", either(new Range(3)), log.length); log = [];
{ const p = new Plain(5); let first = 0; for (const x of p) { first = x; if (x === 1) break; } let rest = 0; for (const x of p) rest += x; console.log("resumed", first, rest); }
// The type is only a prediction: the object decides which method is found. An object from untyped code used as an interface; an inheriting object that overrides the method and returns something else; `next` as an accessor; `next` read once from an object from untyped code.
interface Walkable { [Symbol.iterator](): Plain }
function walk(w: Walkable): number { let s = 0; for (const x of w) { if (x > 50) break; s += x; } return s; }
// It has all that a Plain has, and is none: no object of the class.
const foreign = (n: number): Plain => { const it = { i: 0, n, next(): { value: number, done?: boolean } { say("foreign"); return it.i < n ? { value: 10 + it.i++ } : { value: 0, done: true }; }, return(): { value: number, done: boolean } { say("closed"); return { value: 0, done: true }; }, [Symbol.iterator](): Plain { return it; } }; return it; };
const stranger: Walkable = { [Symbol.iterator]() { return foreign(2); } };
class Heir extends Plain { [Symbol.iterator](): Plain { return foreign(3); } }
console.log("strangers", walk(stranger), walk(new Plain(3)), walk(new Heir(1)), sum(new Heir(1)), log.join()); log = [];
{ const far: Walkable = { [Symbol.iterator]() { return foreign(100); } }; let s = 0; for (const x of far) { if (x > 11) break; s += x; } console.log("a stranger is closed", s, log.join()); log = []; }
class Lazy { i = 0; get next(): () => { value: number, done: boolean } { say("get next"); return () => ({ value: this.i, done: this.i++ >= 2 }); } }
class HasLazy { [Symbol.iterator](): Lazy { return new Lazy(); } }
{ let s = 0; for (const x of new HasLazy()) s += x; console.log("next is an accessor", s, log.join()); log = []; }
// A record for an iterator: `next` is read ONCE: storing another in the loop changes nothing for this loop.
class Bag { constructor(public n: number) {} [Symbol.iterator](): { next: () => { value: number, done: boolean } } { let i = 0; const n = this.n; return { next: () => i < n ? { value: i++, done: false } : { value: 0, done: true } }; } }
function bag(b: Bag): number { let s = 0; for (const x of b) s += x; return s; }
console.log("record", bag(new Bag(4)), bag(new Bag(0)));
class Swapping { it: { next: () => { value: number, done: boolean } }; constructor(n: number) { let i = 0; this.it = { next: () => i < n ? { value: i++, done: false } : { value: 0, done: true } }; } [Symbol.iterator](): { next: () => { value: number, done: boolean } } { return this.it; } }
function swapped(w: Swapping): number { let s = 0; for (const x of w) { w.it.next = () => ({ value: 1000, done: true }); s += x; } return s; }
console.log("next stored to in the loop", swapped(new Swapping(3)));
// The forms of the loop head; a fresh binding for every iteration; nested; in a generator and in an async function.
class Pairs { constructor(public n: number) {} [Symbol.iterator](): PairSteps { return new PairSteps(this.n); } }
class PairSteps { i = 0; constructor(public n: number) {} next(): { value: [number, string], done: boolean } { const at = this.i++; return { value: [at, "s" + at], done: at >= this.n }; } }
{ let t = ""; for (const [a, b] of new Pairs(2)) t += a + b; const o = { p: 0 }; for (o.p of new Plain(3)) t += o.p; var v = 0; for (v of new Plain(2)) t += v; const fs: (() => number)[] = []; for (const x of new Plain(3)) fs.push(() => x); t += fs.map(f => f()).join(); for (const x of new Plain(2)) for (const y of new Plain(2)) t += "" + x + y; console.log("heads", t, v); }
function* through(p: Plain): Generator<number> { for (const x of p) { yield x; yield x * 10; } }
console.log("in a generator", [...through(new Plain(2))].join()); { const g = through(new Plain(5)); g.next(); g.next(); console.log(JSON.stringify(g.return(7)), JSON.stringify(g.next())); }
async function later(p: Plain): Promise<number> { let s = 0; for (const x of p) { s += await Promise.resolve(x); } return s; }
// What goes as before: arrays, strings, Map, Set, generators, arguments, typed arrays, `any`.
{ let t = ""; for (const x of [1, 2]) t += x; for (const c of "ab") t += c; for (const [k, w] of new Map([[1, "m"]])) t += k + w; for (const x of new Set([7])) t += x; for (const x of through(new Plain(1))) t += x; for (const x of new Uint8Array([3])) t += x; const a: any = new Plain(2); for (const x of a) t += x; console.log("as before", t); }
later(new Plain(4)).then(s => console.log("in an async function", s));
