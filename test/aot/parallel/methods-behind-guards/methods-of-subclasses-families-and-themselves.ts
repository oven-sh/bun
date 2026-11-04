// `o.m()` on objects that unseen code has in hand: who is called depends on the object's own class, on what the callee and the arguments do meanwhile, and on how the object was made.
let log = "";
const sink: unknown[] = []; (globalThis as any).sinkOfFamilies = sink;
function escape<T>(o: T): T { sink.push(o); sink.length = 0; return o; }
function attempt(run: () => unknown): string { log = ""; try { return String(run()) + "[" + log + "]"; } catch (e) { return (e instanceof TypeError ? "TypeError" : "other " + e) + "[" + log + "]"; } }

class Shape { area(): number { return 0; } name(): string { return "shape"; } describe(): string { return this.name() + ":" + this.area(); } }
class Square extends Shape { side: number; constructor(side: number) { super(); this.side = side; } area(): number { return this.side * this.side; } name(): string { return "square"; } }
class Circle extends Shape { r: number; constructor(r: number) { super(); this.r = r; } area(): number { return 3 * this.r * this.r; } }
class Unit extends Square { constructor() { super(1); } }
class Odd extends Square { area(): number { return -1; } describe(): string { return "odd " + super.describe(); } }
function area(s: Shape): number { return s.area(); }
function areaOfSquare(s: Square): number { return s.area(); }
function nameOfCircle(c: Circle): string { let s = ""; for (let r = 0; r < 1; r++) s += c.name(); return s; }
function describe(s: Shape): string { return s.describe(); }
function describeSquare(s: Square): string { let t = ""; for (let r = 0; r < 1; r++) t += s.describe() + "/" + s.name() + "/" + s.area(); return t; }
function sum(list: Shape[]): number { let total = 0; for (const s of list) total += s.area(); return total; }
const shapes = () => [new Shape(), new Square(2), new Circle(1), new Unit(), new Odd(3)].map(escape);
console.log(shapes().map(area).join(), shapes().map(describe).join(), sum(shapes()));
console.log([new Square(2), new Unit(), new Odd(3)].map(escape).map(areaOfSquare).join(), [new Square(2), new Unit(), new Odd(3)].map(escape).map(describeSquare).join(), nameOfCircle(escape(new Circle(2))));

// what is no object of the class at all
const strangers: any[] = [Object.create(Square.prototype), { area() { return 42; }, name() { return "literal"; }, describe() { return "d"; } }, Object.create(null), Reflect.construct(Square, [4], Circle), Reflect.construct(Square, [5], Odd), Reflect.construct(Shape, [], Square), Reflect.construct(Square, [6], function () { })];
for (const s of strangers) console.log(attempt(() => area(s)), attempt(() => areaOfSquare(s)), attempt(() => describe(s)), attempt(() => describeSquare(s)));
for (const s of [null, undefined, 5, "text", true, Symbol.iterator, 5n] as any[]) console.log(attempt(() => area(s)), attempt(() => describeSquare(s)));

// the callee lays another method in its own place
class Stepper { n = 0; step(i: number): string { this.n++; if (i === 1) (Stepper.prototype as any).step = function (this: Stepper, i: number) { this.n += 10; return "new" + i; }; return "old" + i; } }
function steps(o: Stepper): string { let s = ""; for (let i = 0; i < 4; i++) s += o.step(i) + ","; return s + o.n; }
class RowStepper { n = 0; step(i: number): string { this.n++; if (i === 1) (RowStepper.prototype as any).step = function (this: RowStepper, i: number) { this.n += 10; return "new" + i; }; return "old" + i; } }
function stepsInARow(o: RowStepper): string { let s = ""; for (let r = 0; r < 1; r++) s += o.step(0) + o.step(1) + o.step(2) + o.step(3); return s + o.n; }
class OwnStepper { n = 0; step(i: number): string { this.n++; if (i === 1) (this as any).step = (i: number) => "own" + i; return "old" + i; } }
function ownSteps(o: OwnStepper): string { let s = ""; for (let r = 0; r < 1; r++) s += o.step(0) + o.step(1) + o.step(2) + o.step(3); return s + o.n; }
class Leaver { n = 0; step(i: number): string { this.n++; if (i === 1) Object.setPrototypeOf(this, { step: (i: number) => "left" + i }); return "old" + i; } }
function leaves(o: Leaver): string { let s = ""; for (let i = 0; i < 4; i++) s += o.step(i) + ","; return s + o.n; }
console.log(steps(escape(new Stepper())), steps(escape(new Stepper())), stepsInARow(escape(new RowStepper())), stepsInARow(escape(new RowStepper())));
console.log(ownSteps(escape(new OwnStepper())), ownSteps(escape(new OwnStepper())), leaves(escape(new Leaver())), leaves(escape(new Leaver())));

// the method is read in front of the arguments
class Late { m(x: string): string { return "old(" + x + ")"; } }
function replaceLate(): string { (Late.prototype as any).m = (x: string) => "new(" + x + ")"; return "argument"; }
function argumentReplaces(o: Late): string { let s = ""; for (let r = 0; r < 1; r++) s += o.m(replaceLate()) + o.m("after"); return s; }
class LateOwn { m(x: string): string { return "old(" + x + ")"; } }
function hide(o: any): string { o.m = (x: string) => "own(" + x + ")"; return "argument"; }
function argumentHides(o: LateOwn): string { let s = ""; for (let r = 0; r < 1; r++) s += o.m(hide(o)) + o.m("after"); return s; }
class LateLink { m(x: string): string { return "old(" + x + ")"; } }
function relink(o: any): string { Object.setPrototypeOf(o, { m: (x: string) => "linked(" + x + ")" }); return "argument"; }
function argumentRelinks(o: LateLink): string { let s = ""; for (let r = 0; r < 1; r++) s += o.m(relink(o)) + o.m("after"); return s; }
console.log(argumentReplaces(escape(new Late())), argumentReplaces(escape(new Late())), argumentHides(escape(new LateOwn())), argumentHides(escape(new LateOwn())), argumentRelinks(escape(new LateLink())), argumentRelinks(escape(new LateLink())));

// how the method takes what it is handed
class Taker {
  tag = "t";
  few(a?: unknown, b: unknown = "b", ...rest: unknown[]): string { return this.tag + a + b + rest.length; }
  all(): string { return this.tag + arguments.length + Array.prototype.join.call(arguments, "-"); }
  async later(x: number): Promise<string> { return this.tag + (await x); }
  *each(n: number): Generator<string> { for (let i = 0; i < n; i++) yield this.tag + i; }
  self(): this { return this; }
  throws(): never { throw new RangeError(this.tag); }
}
function takes(o: Taker): string { return o.few() + o.few(1) + o.few(1, 2) + o.few(1, 2, 3, 4) + o.few(undefined, undefined) + o.all() + (o as any).all(1, 2, 3) + [...o.each(2)].join() + (o.self() === o); }
function spreads(o: Taker, list: unknown[]): string { return o.few(...list) + (o as any).all(...list); }
function detached(o: Taker): string { const few = o.few; return few(1); }
function borrowed(o: Taker, other: object): string { return o.few.call(other, 1) + o.all.apply(other, [1, 2] as any); }
function chained(o: Taker): string { return o.self().self().few(7); }
function thrown(o: Taker): string { try { o.throws(); } catch (e) { return (e as Error).name + (e as Error).message; } }
console.log(takes(escape(new Taker())), spreads(escape(new Taker()), []), spreads(escape(new Taker()), [1, 2, 3]), attempt(() => detached(escape(new Taker()))), borrowed(escape(new Taker()), { tag: "other" }), chained(escape(new Taker())), thrown(escape(new Taker())));
escape(new Taker()).later(5).then(console.log);

// a field, an accessor or a computed key under the name
class Plain { m(): string { return "Plain.m"; } get g(): () => string { log += "g"; return () => "Plain.g"; } }
class FieldOver extends Plain { m = () => "field"; }
class GetterOver extends Plain { get m(): () => string { log += "G"; return () => "getter"; } }
const computed = ["m"].join("");
class ComputedOver extends Plain { [computed](): string { return "computed"; } }
class StaticSame extends Plain { static m(): string { return "static"; } }
function callM(o: Plain): string { return o.m(); }
function callFieldOver(o: FieldOver): string { return o.m(); }
function callGetterOver(o: GetterOver): string { return o.m(); }
function callComputedOver(o: ComputedOver): string { return o.m(); }
function callStaticSame(o: StaticSame): string { return o.m() + StaticSame.m(); }
function callG(o: Plain): string { return o.g(); }
console.log([new Plain(), new FieldOver(), new GetterOver(), new ComputedOver(), new StaticSame()].map(escape).map(o => attempt(() => callM(o))).join(), attempt(() => callFieldOver(escape(new FieldOver()))), attempt(() => callGetterOver(escape(new GetterOver()))), attempt(() => callComputedOver(escape(new ComputedOver()))), callStaticSame(escape(new StaticSame())), attempt(() => callG(escape(new Plain()))));

// classes that are evaluated again and again, and classes with what they capture
function mixin<T extends new (...a: any[]) => Plain>(Base: T, tag: string) { return class Mixed extends Base { m(): string { return tag + super.m(); } }; }
const MixedA = mixin(Plain, "a"), MixedB = mixin(MixedA, "b");
function callMixed(o: InstanceType<typeof MixedA>): string { return o.m(); }
console.log(callMixed(escape(new MixedA())), callMixed(escape(new MixedB())), callM(escape(new MixedB())));
const Capturing = (() => { let count = sink.length + 40; return class Capturing { m(): number { return ++count; } }; })();
function callCapturing(o: InstanceType<typeof Capturing>): number { return o.m() + o.m(); }
console.log(callCapturing(escape(new Capturing())), callCapturing(escape(new Capturing())));

// names that every object has above
class Named { toString(): string { return "Named!"; } valueOf(): number { return 7; } hasOwnProperty(): boolean { return false; } }
class Unnamed { x = 1; }
function texts(o: Named): string { return o.toString() + o.valueOf() + o.hasOwnProperty() + `${o}` + (+o); }
function inherited(o: Unnamed): string { return o.toString() + o.hasOwnProperty("x") + o.hasOwnProperty("y") + (o.valueOf() === o); }
console.log(texts(escape(new Named())), inherited(escape(new Unnamed())));
