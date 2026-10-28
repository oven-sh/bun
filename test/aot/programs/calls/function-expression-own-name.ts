// Inside a named function expression its own name refers to the very function object that the expression created.
declare const console: any;
const seen: unknown[] = [];
function take(f: any): void { seen.push(f); f(1); }
function typed(f: (x: number) => number): void { seen.push(f); f(1); }
function show(name: string): void { const known: unknown[] = []; const ids: number[] = []; for (const s of seen) { let k = known.indexOf(s); if (k < 0) { k = known.length; known.push(s); } ids.push(k); } console.log(name + ": " + ids.join()); seen.length = 0; }
function a(): void { take(function self(x: number): number { seen.push(self); return x; }); }
function b(): void { typed(function self(x: number): number { seen.push(self); return x; }); }
function c(k: number): void { take(function self(x: number): number { seen.push(self); return x + k; }); }
function d(): void { const f = function self(x: number): number { seen.push(self); return x; }; seen.push(f); f(1); }
a(); a(); show("untyped taker, twice"); b(); show("typed taker"); c(2); c(3); show("captures, twice"); d(); show("local");
function twoNames(): void { const f = function g(x: number): number { seen.push(g); seen.push(f); return x; }; take(f); }
function throughArrow(): void { take(function g(x: number): number { const h = () => g; seen.push(h()); return x; }); }
function throughTwoArrows(): void { take(function g(x: number): number { const h = () => () => g; seen.push(h()()); return x; }); }
function returned(): any { return function g(): unknown { return g; }; }
twoNames(); show("two names"); throughArrow(); show("through an arrow"); throughTwoArrows(); show("through two arrows");
{ const r1 = returned(), r2 = returned(); console.log("returned: " + [r1 === r2, r1() === r1, r2() === r2, r1() === r2]); }
function fromAnArrow(): void { const f = function g(x: number): number { seen.push(g); return x; }; const h = (): number => f(1); seen.push(f); h(); h(); }
function fromADeclaration(): void { const f = function g(x: number): number { seen.push(g); return x; }; function h(): number { return f(2); } seen.push(f); take(h); }
function laterInALoop(): void { const later: Array<() => number> = []; for (let i = 0; i < 2; i++) { const f = function g(x: number): number { seen.push(g); return x + i; }; seen.push(f); later.push(() => f(i)); } for (const l of later) l(); }
fromAnArrow(); show("called from an arrow"); fromADeclaration(); show("called from a declaration"); laterInALoop(); show("called later, made in a loop");
// Loops: with and without a block, and their heads.
function forBlock(): void { for (let i = 0; i < 3; i++) { take(function g(x: number): number { seen.push(g); return x + i; }); } }
function forNoBlock(): void { for (let i = 0; i < 3; i++) take(function g(x: number): number { seen.push(g); return x + i; }); }
function forNoBlockNoCapture(): void { for (let i = 0; i < 3; i++) take(function g(x: number): number { seen.push(g); return x; }); }
function forHead(): void { let n = 0; for (take(function g(x: number): number { seen.push(g); return x; }); n < 2 && (take(function t(x: number): number { seen.push(t); return x; }), true); take(function u(x: number): number { seen.push(u); return x; })) n++; }
function whileNoBlock(): void { let i = 0; while (i++ < 3) take(function g(x: number): number { seen.push(g); return x; }); }
function whileTest(): void { let i = 0; while ((take(function g(x: number): number { seen.push(g); return x; }), i++ < 2)) { } }
function doNoBlock(): void { let i = 0; do take(function g(x: number): number { seen.push(g); return x; }); while (++i < 3); }
function doTest(): void { let i = 0; do { } while ((take(function g(x: number): number { seen.push(g); return x; }), ++i < 3)); }
function forOfNoBlock(): void { for (const i of [1, 2, 3]) take(function g(x: number): number { seen.push(g); return x + i; }); }
function forOfIterated(): void { for (const i of (take(function g(x: number): number { seen.push(g); return x; }), [1, 2])) seen.push(i); }
function forInNoBlock(): void { for (const k in { p: 1, q: 2 }) take(function g(x: number): string { seen.push(g); return x + k; }); }
forBlock(); show("for, block"); forNoBlock(); show("for, no block"); forNoBlockNoCapture(); show("for, no block, captures nothing"); forHead(); show("the head of a for"); whileNoBlock(); show("while, no block"); whileTest(); show("the test of a while");
doNoBlock(); show("do, no block"); doTest(); show("the test of a do"); forOfNoBlock(); show("for-of, no block"); forOfIterated(); show("what a for-of iterates over"); forInNoBlock(); show("for-in, no block");
// Classes.
class Field { f = function g(this: unknown): unknown { return g; }; }
class StaticField { static f = function g(this: unknown): unknown { return g; }; }
class InConstructor { f: () => unknown; constructor(k: number) { this.f = function g(): unknown { return k ? g : null; }; } }
class InMethod { make(): () => unknown { return function g(): unknown { return g; }; } }
function classInFunction(): any { return class { f = function g(this: unknown): unknown { return g; }; }; }
{ const f1 = new Field(), f2 = new Field(); console.log("the initializer of a field: " + [f1.f === f2.f, f1.f() === f1.f, f2.f() === f2.f]); }
console.log("the initializer of a static field: " + (StaticField.f() === StaticField.f));
{ const c1 = new InConstructor(1), c2 = new InConstructor(2); console.log("in a constructor: " + [c1.f === c2.f, c1.f() === c1.f, c2.f() === c2.f]); }
{ const m = new InMethod(), m1 = m.make(), m2 = m.make(); console.log("in a method: " + [m1 === m2, m1() === m1, m2() === m2]); }
{ const K = classInFunction(), k1 = new K(), k2 = new K(); console.log("a field of a class in a function: " + [k1.f === k2.f, k1.f() === k1.f, k2.f() === k2.f]); }
// Other places.
function parameterDefault(f: any = function g(): unknown { return g; }): boolean { return f() === f; }
function inLiterals(): boolean[] { const o = { p: function g(): unknown { return g; } }, l = [function h(): unknown { return h; }]; return [o.p() === o.p, l[0]() === l[0]]; }
function conditional(y: boolean): boolean { const f: any = y ? function g(): unknown { return g; } : function h(): unknown { return h; }; return f() === f; }
function immediately(): boolean[] { const f: any = (function g(): unknown { return g; })(); return [typeof f === "function", f() === f]; }
function inCatch(): boolean { try { throw 1; } catch (e) { const f: any = function g(): unknown { return [g, e]; }; return f()[0] === f; } }
function inSwitch(n: number): boolean { switch (n) { case 1: { const f: any = function g(): unknown { return g; }; return f() === f; } default: return false; } }
function inSwitchNoBlock(n: number): boolean { switch (n) { case 1: return (function (f: any): boolean { return f() === f; })(function g(): unknown { return g; }); default: return false; } }
console.log("elsewhere: " + [parameterDefault(), parameterDefault(), inLiterals(), conditional(true), conditional(false), immediately(), inCatch(), inSwitch(1), inSwitchNoBlock(1)]);
// Coroutines.
async function coroutines(): Promise<void> {
    const f: any = async function g(): Promise<unknown> { await 0; return g; }; console.log("async: " + ((await f()) === f));
    const h: any = function* g(): Generator<unknown> { yield g; yield g; }; console.log("generator: " + [...h()].map(v => v === h));
    const k: any = async function* g(): AsyncGenerator<unknown> { yield g; }; for await (const v of k()) console.log("async generator: " + (v === k));
}
// Idioms.
function emitter(): string {
    const listeners: Array<() => void> = []; let calls = 0;
    const on = (f: () => void): void => { listeners.push(f); }, off = (f: () => void): void => { const i = listeners.indexOf(f); if (i >= 0) listeners.splice(i, 1); };
    on(function once(): void { calls++; off(once); });
    for (const f of listeners.slice()) f(); for (const f of listeners.slice()) f();
    return calls + " " + listeners.length;
}
function propertiesOnItself(): unknown[] { const f: any = function g(): void { (g as any).count = ((g as any).count || 0) + 1; }; f(); f(); f(); return [f.count, f.name, f.length]; }
function memo(): unknown[] { const table = new Map<unknown, number>(); const f: any = function g(): number { table.set(g, (table.get(g) || 0) + 1); return table.size; }; f(); f(); return [table.size, table.get(f)]; }
const registry: Array<() => number> = [];
function doesNotKeep(f: () => number): number { return f(); }
function keepsItself(k: number): void { let n = k; doesNotKeep(function g(): number { if (!registry.includes(g)) registry.push(g); return ++n; }); }
function recursion(n: number): number { return (function fact(m: number): number { return m < 2 ? 1 : m * fact(m - 1); })(n); }
function shadowed(): unknown[] { const p: any = function g(g: number): number { return g; }, v: any = function g(): number { var g = 7; return g; }, l: any = function g(): number { const g = 8; return g; }; return [p(5), v(), l()]; }
function nestedSameName(): boolean[] { const outer: any = function g(): unknown[] { const inner: any = function g(): unknown { return g; }; return [g, inner, inner()]; }; const [o, i, r] = outer(); return [o === outer, i === r, o === i]; }
function typeOfIt(): string { return (function g(): string { return typeof g + g.name + g.length; })(); }
console.log("emitter: " + emitter()); console.log("properties on itself: " + propertiesOnItself()); console.log("a table keyed by itself: " + memo());
keepsItself(10); keepsItself(20); console.log("keeps itself: " + [registry.length, registry[0](), registry[0](), registry[1](), registry[0] === registry[1]]);
console.log("recursion: " + recursion(5)); console.log("shadowed: " + shadowed()); console.log("the same name within: " + nestedSameName()); console.log("typeof: " + typeOfIt());
// At the level of the module: once, in a block, in a loop.
const topOnce: any = function g(): unknown { return g; }; console.log("module, once: " + (topOnce() === topOnce));
{ const inBlock: any = function g(): unknown { return g; }; console.log("module, block: " + (inBlock() === inBlock)); }
for (let i = 0; i < 2; i++) take(function g(x: number): number { seen.push(g); return x + i; });
show("module, loop");
await coroutines();
export {};
