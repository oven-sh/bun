// answers: with-library
// # A class without heritage whose constructor begins with a row of `this.k = <a parameter | a written constant>`: the fields are defined in the constructor itself, in the order of their declarations, each with what the
// # row stores into it: `undefined` is never laid, so a read of the field is no `undefined|..`. Beside the plain case: whatever could see the field between its definition and the store, and must still see undefined:
// # a default of a parameter that reads or hands out `this`, a call amid the row, a store in an arm, an early return, a throw, an initializer that reads or hands out `this`, a class below that lays the name again;
// # and what may not change: the order of the keys, accessors above that may not run, an argument left out, Reflect.construct with another target, a parameter that a closure holds.
// # f5 = lengths, f7 = heavy, f8 = Point
// # RUN(FORM): walk f5 f7 f8 mechanisms=all
// # FORM-LABEL: code f5:Body
// # FORM: : string @JSValue = GetSlot {{*}}key="name"
// # FORM: : int[0, 2147483647] @Int64 = GetSlot {{*}}key="size"
// # FORM-LABEL: code f7:Body
// # FORM: @Double = GetSlot {{*}}key="m"
// # FORM-LABEL: code f8:Body
// # FORM: = PutSlotOrAdd {{*}}key="x" {{*}}[isDefinition, isExpectedToCreate]
// # FORM: = PutSlotOrAdd {{*}}key="y" {{*}}[isDefinition, isExpectedToCreate]
// # FORM-NOT: PutSlot
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 31 of 31 of 31
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
const seen: unknown[] = [];
function look(object: object): void { seen.push(Object.keys(object).join() + ":" + JSON.stringify(object)); }
let made = 0;
function next(): number { return ++made; }

class Point { x: number; y: number; constructor(x: number, y: number) { this.x = x; this.y = y; } }
function sum(points: Point[]): number { let total = 0; for (let i = 0; i < points.length; i++) { const point = points[i]!; total += point.x * 2 + point.y; } return total; }
const points: Point[] = [];
for (let i = 0; i < 40; i++) points.push(new Point(i + 0.5, i));
report(sum(points));
report(Object.keys(points[3]!).join());

class Turned { first: number; second: number; constructor(first: number, second: number) { this.second = second; this.first = first; } }
report(Object.keys(new Turned(1, 2)).join() + JSON.stringify(new Turned(1, 2)));

class Half { first: number; second: number | undefined; third = 3; constructor(first: number) { this.first = first; } }
report(Object.keys(new Half(1)).join() + ":" + new Half(1).second + ":" + ("second" in new Half(1)));

class Mixed { a = 1; b: number; c = "c"; d: number; e = -2; f = null; g = true; constructor(b: number, d: number) { this.d = d; this.b = b; } }
report(Object.keys(new Mixed(7, 8)).join() + JSON.stringify(new Mixed(7, 8)));

class Constants { text: string; yes: boolean; none: null; minus: number; whole: number; constructor() { this.text = "t"; this.yes = true; this.none = null; this.minus = -1.5; this.whole = 4 as number; } }
report(JSON.stringify(new Constants()));

// @ts-ignore
class Default { x: unknown; y: number; constructor(x: unknown = (this as any).y, y: number = 2) { this.x = x; this.y = y; } }
report(String(new Default().x) + ":" + new Default().y);

// @ts-ignore
class HandsOut { x: unknown; y: number; constructor(x: unknown = look(this), y: number) { this.x = x; this.y = y; } }
new HandsOut(undefined, 5);
report(seen.pop());

class Broken { a: number; b: number; constructor(a: number, b: number) { this.a = a; look(this); this.b = b; } }
new Broken(1, 2);
report(seen.pop());

class ReadsItself { a: unknown; b: unknown; constructor(b: number) { this.a = this.b; this.b = b; } }
report(JSON.stringify(new ReadsItself(3)) + ":" + String(new ReadsItself(3).a));

class Twice { a: number; constructor(a: number, b: number) { this.a = a; this.a = b; } }
report(new Twice(1, 2).a);

class InAnArm { a: number | undefined; constructor(a: number, take: boolean) { if (take) this.a = a; } }
report(String(new InAnArm(1, false).a) + ":" + new InAnArm(1, true).a + ":" + Object.keys(new InAnArm(1, false)).join());

class Early { a: number; b: number | undefined; constructor(a: number, b: number) { this.a = a; if (a < 0) return; this.b = b; } }
report(JSON.stringify(new Early(-1, 2)) + Object.keys(new Early(-1, 2)).join() + JSON.stringify(new Early(1, 2)));

class LeftOut { a: number; b: number; constructor(a: number, b?: any) { this.a = a; this.b = b; } }
function ofLeftOut(list: LeftOut[]): string { let total = 0; let missing = 0; for (const one of list) { if (one.b === undefined) missing++; else total += one.b; total += one.a; } return total + ":" + missing; }
report(ofLeftOut([new LeftOut(1, 2.5), new LeftOut(2), new LeftOut(3, 4)]));

const thrown: Throws[] = [];
class Throws { a: number; b: number | undefined; constructor(a: number) { this.a = a; thrown.push(this); if (a > 0) throw new Error("no"); this.b = a; } }
try { new Throws(1); } catch (error) { report((error as Error).message + JSON.stringify(thrown[0]) + Object.keys(thrown[0]!).join()); }

let ran = 0;
class Guarded { guarded: number; constructor(guarded: number) { this.guarded = guarded; } }
Object.defineProperty(Guarded.prototype, "guarded", { set(value: unknown) { ran++; }, get() { ran++; return 9; }, configurable: true });
report(new Guarded(4).guarded + ":" + ran + ":" + Object.keys(new Guarded(4)).join());

class WithAccessor { get own(): number { ran++; return 1; } set own(value: number) { ran++; } }
class Hides extends WithAccessor { }
class HidesItsOwn { value: number; constructor(value: number) { this.value = value; } get double(): number { return this.value * 2; } }
report(new HidesItsOwn(21).double + ":" + new Hides().own);

class Below extends Point { z: number; constructor(x: number, y: number, z: number) { super(x, y); this.z = z; } }
report(Object.keys(new Below(1, 2, 3)).join() + JSON.stringify(new Below(1, 2, 3)) + sum([new Below(1, 2, 3), new Point(4, 5)]));

class LaysAgain extends Point { declare x: number; y: any = undefined; constructor() { super(1, 2); } }
report(JSON.stringify(new LaysAgain()) + ":" + String(new LaysAgain().y) + ":" + Object.keys(new LaysAgain()).join());

class Other { tell(): string { return "other"; } }
const turned = Reflect.construct(Point, [6, 7], Other) as Point & Other;
report(turned.tell() + JSON.stringify(turned) + (turned instanceof Point) + sum([turned as Point]));

class ReadsThis { a: number; b: unknown = (this as any).a; constructor(a: number) { this.a = a; } }
report(String(new ReadsThis(1).b) + ":" + new ReadsThis(1).a);

class HandsThisOut { a: number; b: unknown = look(this); constructor(a: number) { this.a = a; } }
new HandsThisOut(1);
report(seen.pop());

class Calls { id = next(); a: number; constructor(a: number) { this.a = a; } }
report(JSON.stringify(new Calls(5)) + JSON.stringify(new Calls(6)));

class Captured { a: number; read: () => number; constructor(a: number) { this.a = a; this.read = () => a; a = a + 1; } }
report(new Captured(1).a + ":" + new Captured(1).read());

class Counts { a: number; n: number; constructor(a: number) { this.a = a; this.n = arguments.length; } }
report(JSON.stringify(new (Counts as any)(1, 2, 3)));

class ByName { "quoted name": number | undefined; plain: number; constructor(plain: number) { this.plain = plain; this["quoted name"] = 1; } }
report(Object.keys(new ByName(2)).join("|"));

class Frozen { a: number; constructor(a: number) { this.a = a; Object.freeze(this); } }
report(Object.isFrozen(new Frozen(1)) + ":" + new Frozen(2).a);

class Texts { name: string; size: number; constructor(name: string, size: number) { this.name = name; this.size = size; } }
function lengths(list: Texts[]): number { let total = 0; for (const one of list) total += one.name.length * one.size; return total; }
report(lengths([new Texts("ab", 2), new Texts("cde", 3)]));

class Holds { inner: Point; constructor(inner: Point) { this.inner = inner; } }
function inner(list: Holds[]): number { let total = 0; for (const one of list) total += one.inner.x; return total; }
report(inner([new Holds(new Point(1.5, 0)), new Holds(new Point(2.5, 0))]));

class Mass { m: number; constructor(m: number) { this.m = m; } }
function heavy(list: Mass[]): number { let total = 0; for (let i = 0; i < list.length; i++) total += list[i]!.m; return total; }
report(heavy([new Mass(0.5), new Mass(1.25), new Mass(2)]));
report("end");
