function say(n, f) { let r; try { r = JSON.stringify(f()); if (r === undefined) r = "undefined"; } catch (e) { r = "throws " + e.constructor.name; } console.log(n + ": " + r); }
const log = [];
function take() { return log.splice(0).join(","); }
// It calls itself: it stays a call wherever it is called from.
function rec(n) { return n > 0 ? rec(n - 1) + 1 : 0; }
function noted(x) { log.push("noted " + rec(x)); return x; }
function make(C, a) { return new C(a); }
class B { constructor(x) { log.push("B " + new.target.name); this.x = x; } }
class Other { constructor(x) { log.push("Other " + new.target.name); this.other = x; } }
class Ahead extends B { constructor(x) { rec(3); super(x); this.a = 1; } }
class AsArgument extends B { constructor(x) { super(rec(x)); } }
class TwoAhead extends B { constructor(x) { noted(1); noted(2); super(x); } }
class InArm extends B { constructor(x) { if (x > 1) rec(x); else log.push("else"); super(x); } }
class InLoop extends B { constructor(x) { for (let i = 0; i < x; i++) rec(i); super(x); } }
class InTry extends B { constructor(x) { try { rec(x); } catch { } super(x); } }
class Behind extends B { constructor(x) { super(x); this.r = rec(x); } }
class OverAhead extends Ahead { constructor(x) { super(x); this.o = 1; } }
class OverOverAhead extends OverAhead { constructor(x) { rec(1); super(x); } }
class ImplicitOverAhead extends Ahead { }
class Field extends B { f = rec(4); }
class FieldOverAhead extends Ahead { f = rec(2); constructor(x) { rec(1); super(x); } }
for (const C of [Ahead, AsArgument, TwoAhead, InArm, InLoop, InTry, Behind, OverAhead, OverOverAhead, ImplicitOverAhead, Field, FieldOverAhead])
    say(C.name + ", the site does not know it", () => { log.length = 0; return [make(C, 2), take()]; });
say("the site names it", () => { log.length = 0; const r = [new Ahead(2), new AsArgument(2), new TwoAhead(2), new InArm(2), new InArm(1), new InLoop(2), new InTry(2), new Behind(2), new OverAhead(2), new OverOverAhead(2), new ImplicitOverAhead(2), new Field(2), new FieldOverAhead(2)]; return [r, take()]; });
say("in a loop", () => { let t = 0; for (let i = 0; i < 2000; i++) t += new Ahead(i).x + new OverOverAhead(i).o + new AsArgument(i & 3).x + new FieldOverAhead(i).f; log.length = 0; return t; });
say("a call ahead of the `new`", () => { log.length = 0; rec(2); const a = new OverAhead(1); const n = rec(3); const b = new OverAhead(n); return [a, b, take()]; });
say("a call for an argument of the `new`", () => { log.length = 0; return [new OverAhead(rec(3)), new Ahead(noted(2)), take()]; });
// What stands ahead changes the parent.
class Moves extends B { constructor(x) { swap(Moves, x); super(x); this.m = 1; } }
class MovesOver extends Moves { constructor(x) { super(x); } }
class MovedByArgument extends B { constructor(x) { super(x); } }
class MovedBelow extends MovedByArgument { constructor(x) { swap(MovedByArgument, x); super(x); } }
function swap(C, x) { rec(1); Object.setPrototypeOf(C, x & 1 ? Other : B); return x; }
say("the constructor's own parent, by a call ahead of super", () => { log.length = 0; return [new Moves(1), new Moves(2), new Moves(3), make(Moves, 1), make(Moves, 2), take()]; });
say("the same from a class above", () => { log.length = 0; return [new MovesOver(1), new MovesOver(2), make(MovesOver, 1), make(MovesOver, 2), take()]; });
say("the parent's parent, by a call ahead of super", () => { log.length = 0; return [new MovedBelow(1), new MovedBelow(2), new MovedBelow(1), take()]; });
say("by an argument of the `new`", () => { log.length = 0; const r = [new MovedByArgument(swap(MovedByArgument, 1)), new MovedByArgument(swap(MovedByArgument, 2)), new MovedBelow(swap(MovedByArgument, 1))]; return [r, take()]; });
say("by a call ahead of the `new`", () => { log.length = 0; swap(MovedByArgument, 1); const a = new MovedByArgument(5); swap(MovedByArgument, 2); const b = new MovedByArgument(6); return [a, b, take()]; });
// Past the eight classes that are asked ahead of the birth.
class C1 extends B { constructor(x) { super(x); } } class C2 extends C1 { constructor(x) { super(x); } } class C3 extends C2 { constructor(x) { super(x); } } class C4 extends C3 { constructor(x) { super(x); } } class C5 extends C4 { constructor(x) { super(x); } }
class C6 extends C5 { constructor(x) { super(x); } } class C7 extends C6 { constructor(x) { super(x); } } class C8 extends C7 { constructor(x) { super(x); } } class C9 extends C8 { constructor(x) { super(x); } } class C10 extends C9 { constructor(x) { rec(1); super(x); } }
say("ten classes", () => { log.length = 0; rec(2); const a = new C10(1); const b = make(C10, 2); return [a, b, a instanceof C1, take()]; });
say("ten classes, the lowest moved", () => { log.length = 0; Object.setPrototypeOf(C1, Other); rec(1); const a = new C10(1); Object.setPrototypeOf(C1, B); rec(1); const b = new C10(2); return [a, b, take()]; });
// Suspensions.
function* yields(x) { log.push("start"); yield 1; const a = new OverAhead(x); const v = yield a; const b = new MovedByArgument(v); yield b; for (let i = 0; i < 2; i++) { yield new Ahead(i); } try { yield 9; return new OverOverAhead(x); } finally { log.push("finally"); } }
say("a generator", () => { log.length = 0; const g = yields(1), r = []; r.push(g.next().value, g.next().value); Object.setPrototypeOf(MovedByArgument, Other); r.push(g.next(7).value); Object.setPrototypeOf(MovedByArgument, B); for (let i = 0; i < 5; i++) r.push(g.next().value); return [r, take()]; });
function* yieldsArgument() { const a = new OverAhead(yield 1); return new MovedByArgument(yield a); }
say("a yield for an argument", () => { log.length = 0; const g = yieldsArgument(), r = [g.next().value, g.next(4).value]; Object.setPrototypeOf(MovedByArgument, Other); r.push(g.next(5).value); Object.setPrototypeOf(MovedByArgument, B); return [r, take()]; });
class WithMethods extends Ahead { constructor(x) { super(x); } async later(x) { await 0; return new WithMethods(x); } *each(n) { for (let i = 0; i < n; i++) yield new WithMethods(i); } static async make(x) { const v = await x; return new this(v); } }
say("a generator method", () => { log.length = 0; const r = [...new WithMethods(0).each(2)]; log.length = 0; return r; });
async function awaits(x) { await 0; const a = new OverAhead(x); const v = await rec(2); const b = new Ahead(v); const c = new MovedByArgument(await x); for (let i = 0; i < 2; i++) { await i; new OverOverAhead(i); } try { await 0; return [a, b, c, new FieldOverAhead(await 3)]; } finally { log.push("finally"); } }
const arrow = async x => { await 0; return new OverAhead(x); };
async function all() {
    log.length = 0; console.log("an async function: " + JSON.stringify([await awaits(1), take()]));
    const pending = awaits(2); Object.setPrototypeOf(MovedByArgument, Other); const moved = await pending; Object.setPrototypeOf(MovedByArgument, B); log.length = 0;
    console.log("the parent moved while it waits: " + JSON.stringify(moved[2]));
    console.log("an async arrow, an async method, a static one: " + JSON.stringify([await arrow(1), await new WithMethods(1).later(2), await WithMethods.make(3)])); log.length = 0;
}
all().then(() => console.log("done"), e => console.log("rejected: " + e));
