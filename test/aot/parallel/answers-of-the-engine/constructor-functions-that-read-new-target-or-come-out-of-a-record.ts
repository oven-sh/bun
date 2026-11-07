// A constructor function whose callee is known, or held to be known, is constructed in the place of the call: the object is made there under the layout of the class.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
function Point(this: any, x: number): any { if (!new.target) return new (Point as any)(x + 100); this.x = x; this.y = new.target === Point ? 0 : 1; } // @ts-expect-error
Point.prototype.sum = function (this: any) { return this.x + this.y; };
function Answer(this: any, kind: number): any { this.kind = kind; if (kind === 1) return { other: true }; if (kind === 2) return 7; if (kind === 3) return null; if (kind === 4) return Answer; }
function Pair(this: any, a: number) { this.a = a; this.b = a + 1; }
Pair.prototype.both = function (this: any) { return this.a * 10 + this.b; };
function Other(this: any, a: number) { this.c = a; }
Other.prototype.both = function (this: any) { return -this.c; };
function Below(this: any, x: number) { Point.call(this, x); this.z = 5; } // @ts-expect-error
Below.prototype = Object.create(Point.prototype);
const record: any = { Pair };
const holders: any[] = [record];
function leak(value: unknown) { holders.push(value); return holders.length; }
leak(record);
const swap = new Function("holder", "value", "holder.Pair = value");
function makePoint(n: number) { const p = new (Point as any)(n); return [p.x, p.y, p.sum(), p instanceof Point, Object.getPrototypeOf(p) === Point.prototype, Object.keys(p).join()].join("|"); }
function callPoint(n: number) { const p = (Point as any)(n); return [p.x, p.y, p instanceof Point].join("|"); }
function makeAnswer(kind: number) { const a = new (Answer as any)(kind); return [typeof a, a instanceof Answer, a === Answer, a.kind, a.other].join("|"); }
function makePair(n: number) { const q = new record.Pair(n); return [q.both(), Object.keys(q).join(), q instanceof Pair].join("|"); }
function makeBelow(n: number) { const b = new (Below as any)(n); return [b.x, b.y, b.z, b.sum(), b instanceof Point].join("|"); }
function byReflect(n: number) { const p = Reflect.construct(Point, [n], Pair); return [p.x, p.y, p instanceof Point, p instanceof Pair].join("|"); }
for (let n = 0; n < 3; n++) report(makePoint(n));
report(callPoint(4));
for (let kind = 0; kind < 5; kind++) report(makeAnswer(kind));
for (let n = 0; n < 3; n++) report(makePair(n));
report(makeBelow(6));
report(byReflect(7));
swap(record, Other);
report(makePair(8));
swap(record, Pair);
report(makePair(9));
Point.prototype = { sum() { return "replaced"; } };
report(makePoint(10));
swap(record, 5);
try { report(makePair(11)); } catch (e: any) { report(e.name); }
swap(record, () => 1);
try { report(makePair(12)); } catch (e: any) { report(e.name); }
Object.freeze(Pair.prototype);
swap(record, Pair);
report(makePair(13));
report("end");
