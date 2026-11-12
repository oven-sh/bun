// an empty slot says that the object has no such property, so the read goes on above it: to a value, a method, an accessor or a read-only property of the prototype, one that is there from the start or laid there later. `in` and hasOwnProperty in front of the store, behind it and behind a deletion
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
function F(this: any, n: number) { this.n = n; }
F.prototype.shared = "from prototype";
F.prototype.method = function () { return "method of " + this.n; };
Object.defineProperty(F.prototype, "guarded", { get() { return "getter " + this.n; }, set(v) { this.seen = v; }, configurable: true });
Object.defineProperty(F.prototype, "fixed", { value: "read only above", writable: false, configurable: true });
class A { n: number; constructor(n: number) { this.n = n; } method() { return "A.method " + this.n; } get guarded() { return "A.getter " + this.n; } set guarded(v) { (this as any).seen = v; } }
const show = (o: any) => { let f = ""; for (const k in o) f += k + ","; return Object.keys(o).join(",") + "|" + f; };
function use(o: any, turn: number) { const before = [o.shared, o.method(), o.guarded, o.fixed, String(o.toString === Object.prototype.toString), o.seen].join(";"); if (turn & 1) o.shared = "own"; if (turn & 2) o.method = () => "own method " + o.n; o.guarded = "g" + turn; try { o.fixed = "own fixed"; } catch (e) { } if (turn & 4) o.toString = () => "own toString"; if (turn & 4) o.constructor = 5; const after = [o.shared, o.method(), o.guarded, o.fixed, String(o), o.seen, typeof o.constructor].join(";"); if (turn & 1) delete o.shared; if (turn & 2) delete o.method; return before + " -> " + after + " -> " + [o.shared, o.method()].join(";") + " " + show(o); }
for (let turn = 0; turn < 8; turn++) { report(use(new (F as any)(turn), turn)); report(use(new A(turn), turn)); }
function G(this: any, n: number) { this.n = n; }
const withOwn = new (G as any)(1);
withOwn.extra = "own";
const without = new (G as any)(2);
const readExtra = (o: any) => o.extra;
report(readExtra(withOwn) + String(readExtra(without)));
G.prototype.extra = "late on prototype";
report(readExtra(withOwn) + readExtra(without) + ("extra" in without) + Object.hasOwn(without, "extra"));
Object.setPrototypeOf(without, { extra: "other prototype" });
report(readExtra(withOwn) + readExtra(without));
interface R { n: number; late?: number; never?: number }
function R(this: R, n: number) { this.n = n; }
function probe(o: R) { return [("late" in o), Object.prototype.hasOwnProperty.call(o, "late"), Object.hasOwn(o, "late"), o.late, ("never" in o), o.never, Object.hasOwn(o, "never"), Object.prototype.propertyIsEnumerable.call(o, "late")].join(","); }
for (let turn = 0; turn < 6; turn++) { const o: R = new (R as any)(turn); report(probe(o)); if (turn % 3 === 0) o.late = undefined; else if (turn % 3 === 1) o.late = turn; report(probe(o)); if (turn > 2) delete o.late; report(probe(o)); }
report("end");
