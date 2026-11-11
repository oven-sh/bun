// answers: with-library
// # In a class without heritage nobody can reach the object until code names `this` or `super`: defaults and patterns of parameters, statements that name neither and hold no `return`, and any stored value that names
// # neither may stand between the allocation and the definitions of the fields; each value is computed where its statement stands. What must stay: the order of what runs, the order of the keys, undefined wherever the
// # object is seen early (an arrow that holds `this`, `super.valueOf()`, a look amid the stores), a `return` in front of or amid the stores, a throw, a parameter that the body changes, a constructor that makes its own kind.
// # f6 = sizes, f7 = taken
// # RUN(FORM): walk f6 f7 mechanisms=all
// # FORM-LABEL: code f6:Body
// # FORM: : number @Double = GetSlot {{*}}key="size"
// # FORM-LABEL: code f7:Body
// # FORM: : number @{{*}} = GetSlot {{*}}key="a"
// # FORM: : Array<number> @JSValue = GetSlot {{*}}key="rest"
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 24 of 24 of 24
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const seen: unknown[] = [];
function look(object: object): number { seen.push(Object.keys(object).join() + ":" + JSON.stringify(object)); return seen.length; }
function log(text: string): string { seen.push(text); return text; }
function drain(): string { return seen.splice(0).join("|"); }

class Sized { size: number; constructor(options: { size: number }) { const size = options.size * 1.5; this.size = size; } }
function sizes(list: Sized[]): number { let sum = 0; for (let i = 0; i < list.length; i++) sum += list[i]!.size; return sum; }
report(sizes([new Sized({ size: 1 }), new Sized({ size: 2.25 }), new Sized({ size: 3 })]));

class Taken { a: number; b: number; rest: number[]; constructor({ a, b = 2 }: { a: number; b?: number }, ...rest: number[]) { this.a = a; this.b = b; this.rest = rest; } }
function taken(list: Taken[]): number { let sum = 0; for (const one of list) sum += one.a * one.b + one.rest.length; return sum; }
report(taken([new Taken({ a: 1.5 }), new Taken({ a: 2, b: 3 }, 7, 8)]));

class Shown { a: number; b: number; rest: number[]; constructor({ a, b = 2 }: { a: number; b?: number }, ...rest: number[]) { this.rest = rest; this.b = b; this.a = a; } }
report(Object.keys(new Shown({ a: 1 }, 5)).join() + JSON.stringify(new Shown({ a: 1 }, 5)));

class InOrder { a: string; b: string; c: string | undefined; constructor() { this.b = log("b"); log("between"); this.a = log("a"); } }
report(Object.keys(new InOrder()).join() + JSON.stringify(new InOrder()) + drain());

class Returns { a: number | undefined; constructor(a: number) { if (a < 0) return; this.a = a; } }
report(Object.keys(new Returns(-1)).join() + ":" + String(new Returns(-1).a) + ":" + new Returns(1).a);

class ReturnsAmid { a: number; b: number | undefined; constructor(a: number) { this.a = a; if (a < 0) return; this.b = a; } }
report(JSON.stringify(new ReturnsAmid(-1)) + Object.keys(new ReturnsAmid(-1)).join() + JSON.stringify(new ReturnsAmid(1)));

class ByAnArrow { a: number; constructor(a: number) { const get = () => this.a as unknown; seen.push(String(get())); this.a = a; } }
report(new ByAnArrow(1).a + drain());

// @ts-ignore
class BySuper { a: number; constructor(a: number) { look(super.valueOf()); this.a = a; } }
report(new BySuper(1).a + drain());

class NamesItself { a: unknown; b: unknown; constructor(b: number) { const twice = b * 2; this.b = twice; this.a = this.b; } }
report(JSON.stringify(new NamesItself(3)));

class HandedOutAmid { a: number; b: number; constructor(a: number) { const more = a + 1; this.a = a; look(this); this.b = more; } }
report(JSON.stringify(new HandedOutAmid(1)) + drain());

class Throws { a: number; b: number; constructor(a: number) { this.a = a; if (a > 5) throw new Error("big"); this.b = a + 1; } }
try { new Throws(9); } catch (error) { report((error as Error).message + JSON.stringify(new Throws(1))); }

function fail(): number { throw new Error("no value"); }
class ValueThrows { a: number; b: number; constructor() { this.a = 1; this.b = fail(); } }
try { new ValueThrows(); } catch (error) { report((error as Error).message); }

class Changed { q: number; constructor(public p: number, q: number) { p = 100; q = q + p; this.q = q; } }
report(JSON.stringify(new Changed(1, 2)));

class Loops { total: number; tries: number; constructor(list: number[]) { let total = 0; for (const n of list) total += n; let tries = 0; try { fail(); } catch { tries++; } this.total = total; this.tries = tries; } }
report(JSON.stringify(new Loops([1, 2, 3.5])));

const options = { get a(): number { log("the getter"); return 4; } };
class ReadsAGetter { a: number; constructor(from: { a: number }) { log("in front"); this.a = from.a; log("behind"); } }
report(new ReadsAGetter(options).a + drain());

class Nest { child: Nest | null; depth: number; constructor(depth: number) { const child = depth > 0 ? new Nest(depth - 1) : null; this.child = child; this.depth = depth; } }
function deep(nest: Nest | null): number { let sum = 0; while (nest) { sum += nest.depth; nest = nest.child; } return sum; }
report(deep(new Nest(4)) + JSON.stringify(new Nest(1)));

class Inner { value: number; constructor(value: number) { this.value = value; } }
class Outer { inner: Inner; twice: number; constructor(value: number) { this.inner = new Inner(value); this.twice = value * 2; } }
function inners(list: Outer[]): number { let sum = 0; for (const one of list) sum += one.inner.value + one.twice; return sum; }
report(inners([new Outer(1.5), new Outer(2)]));

class ByTarget { name: string; constructor() { const target = new.target; this.name = target.name; } }
class BelowTarget extends ByTarget { }
report(new ByTarget().name + new BelowTarget().name);

class HoldsAFunction { a: number; constructor(a: number) { const own = function (this: unknown) { return this; }; seen.push(String(own.call(7))); this.a = a; } }
report(new HoldsAFunction(2).a + drain());

class Later { a: number; read: () => number; constructor(a: number) { const read = () => a; this.read = read; a = a + 1; this.a = a; } }
report(new Later(1).a + ":" + new Later(1).read());

class Defaults { a: number; b: number; constructor(a: number = look(seen), b: number = a + 1) { this.a = a; this.b = b; } }
report(JSON.stringify(new Defaults()) + JSON.stringify(new Defaults(5)) + seen.splice(0).length);

function each(list: number[], change: (one: number) => number): number[] { const out: number[] = []; for (const one of list) out.push(change(one)); return out; }
class ReturnsWithin { items: number[]; n: number; constructor(list: number[]) { const doubled = each(list, one => { return one * 2; }); this.items = each(doubled, function (one) { return one + 1; }); this.n = list.length; } }
function within(list: ReturnsWithin[]): number { let sum = 0; for (const one of list) sum += one.n + one.items.length + one.items[0]!; return sum; }
report(within([new ReturnsWithin([3, 1, 2]), new ReturnsWithin([5])]));

class ReturnsAnother { a: number | undefined; constructor(a: number) { const other = { a: -1 }; if (a < 0) return other as ReturnsAnother; this.a = a; } }
report(JSON.stringify(new ReturnsAnother(-1)) + JSON.stringify(new ReturnsAnother(1)) + (new ReturnsAnother(-1) instanceof ReturnsAnother));
report("end");
