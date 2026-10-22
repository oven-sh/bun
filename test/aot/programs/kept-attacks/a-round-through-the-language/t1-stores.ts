// A round through the language, one probe of many. It prints what plain Bun prints.
function say(label: string, v: unknown): void { console.log(label + " " + typeof v + " " + String(v)); }
type P = { x: number; y: string };
let modNum: number = 0;
function setMod(n: number): void { modNum = n; }
function readMod(): number { return modNum + 1; }
function counter() { let c: number = 0; return { set(n: number): void { c = n; }, get(): number { return c * 2; } }; }
class Box { v: number = 0; set(n: number): void { this.v = n; } get(): number { return this.v + 1; } }
class Stat { static s: number = 0; static set(n: number): void { Stat.s = n; } static get(): number { return Stat.s + 1; } }
class Priv { #v: number = 0; set(n: number): void { this.#v = n; } get(): number { return this.#v + 1; } }
const xs: number[] = [];
function push(n: number): void { xs.push(n); }
function last(): number { return xs[xs.length - 1] + 1; }
const table = new Map<string, number>();
function put(n: number): void { table.set("k", n); }
function got(): number { return table.get("k")! + 1; }
function mk(n: number): () => number { return () => n + 1; }
function inner(m: number): number { return m * 2; }
function outer(n: number): number { return inner(n); }
function mkP(x: number): P { return { x, y: "s" }; }
function readP(p: P): number { return p.x + 1; }
function ternary(n: number, m: number): number { return n > m ? n : m; }
function compound(n: number): number { let r = 1; r += n; return r; }
function loop(n: number): number { let t = 0; for (let i = 0; i < n; i++) t += i; return t; }
const c = counter(), box = new Box(), priv = new Priv();
setMod(1); say("mod", readMod()); (setMod as any)("m"); say("mod-bad", readMod()); setMod(2); say("mod-again", readMod());
c.set(1); say("captured", c.get()); (c.set as any)("3"); say("captured-bad", c.get()); (c.set as any)("x"); say("captured-bad2", c.get());
box.set(1); say("field", box.get()); (box as any).set("f"); say("field-bad", box.get()); (box as any).v = "direct"; say("field-bad2", box.get()); box.set(5); say("field-again", box.get());
Stat.set(1); say("static", Stat.get()); (Stat.set as any)("st"); say("static-bad", Stat.get());
priv.set(1); say("private", priv.get()); (priv as any).set("p"); say("private-bad", priv.get());
push(1); say("array", last()); (push as any)("a"); say("array-bad", last());
put(1); say("map", got()); (put as any)("mp"); say("map-bad", got());
say("closure", mk(1)()); say("closure-bad", (mk as any)("c")());
say("passed-on", outer(2)); say("passed-on-bad", (outer as any)("4")); say("passed-on-bad2", (outer as any)("z")); say("inner", inner(3));
say("literal", readP(mkP(1))); say("literal-bad", readP((mkP as any)("L"))); say("literal-typed", readP({ x: 5, y: "z" }));
say("ternary", ternary(1, 2)); say("ternary-bad", (ternary as any)("b", "a"));
say("compound", compound(1)); say("compound-bad", (compound as any)("c"));
say("loop", loop(3)); say("loop-bad", (loop as any)("3"));
