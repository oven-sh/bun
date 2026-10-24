// Repeated property reads that must not reuse the earlier value: something may have written in between, or the read runs code.
declare const console: any;
const log: any[] = [];
interface P { a: number; b: number; opt?: number; next: P | undefined }
function fresh(): P { return { a: 1, b: 2, next: undefined }; }

// A store through the same value, through another value that is the same object, through a field of another object.
function sameValue(t: P) { const x = t.a; t.a = x + 10; return x + ":" + t.a; }
function alias(t: P, u: P) { const x = t.a; u.a = x + 10; return x + ":" + t.a; }
function viaNext(t: P) { const x = t.a; t.next!.a = x + 10; return x + ":" + t.a; }
// A call in between.
let shared: P = fresh();
function bump() { shared.a += 100; }
function callBetween(t: P) { const x = t.a; bump(); return x + ":" + t.a; }
function callOfValue(t: P, f: () => void) { const x = t.a; f(); return x + ":" + t.a; }
// Only one branch stores.
function oneArm(t: P, flag: boolean) { const x = t.a; if (flag) t.a = x + 10; return x + ":" + t.a; }
// A loop: the read at the top repeats the one before the loop only the first time.
function loop(t: P, n: number) { let r = "" + t.a; for (let i = 0; i < n; i++) { r += "," + t.a; t.a += 1; } return r + ";" + t.a; }
function loopCall(t: P, n: number) { let r = "" + t.a; for (let i = 0; i < n; i++) { r += "," + t.a; bump(); } return r + ";" + t.a; }
// A new object each time around.
function freshInLoop(n: number) { let r = ""; for (let i = 0; i < n; i++) { const o: P = { a: i, b: 0, next: undefined }; r += o.a; if (i & 1) o.a = -i; r += "/" + o.a + " "; } return r; }
// Accessors: every read runs the getter; a setter stores elsewhere.
class Counter { n = 0; hidden = 5; get next() { return ++this.n; } set poke(v: number) { this.hidden = v; } }
function getter(c: Counter) { return c.next + ":" + c.next + ":" + c.next; }
function setter(c: Counter) { const x = c.hidden; c.poke = x + 1; return x + ":" + c.hidden; }
// An accessor on the prototype of a constructor function.
interface Made { v: number; w: number }
function Made(this: Made) { this.v = 1; }
let reads = 0;
Object.defineProperty(Made.prototype, "w", { get() { return ++reads; }, configurable: true });
function inherited(m: Made) { return m.w + ":" + m.w; }
// Receivers of which nothing is known, a proxy among them.
function untyped(o: any) { return o.a + ":" + o.a; }
let traps = 0;
const proxy: any = new Proxy({ a: 0 } as any, { get() { return ++traps; } } as any);
// delete, and a property that is not there yet.
function deleted(t: P) { const x = t.opt; delete t.opt; return x + ":" + t.opt; }
function added(t: P) { const x = t.opt; (t as any).opt = 9; return x + ":" + t.opt; }
function addedByName(t: P, key: string) { const x = t.opt; (t as any)[key] = 8; return x + ":" + t.opt; }
// Built-ins that store or call back.
function assigned(t: P) { const x = t.a; Object.assign(t, { a: 50 }); return x + ":" + t.a; }
function defined(t: P) { const x = t.a; Object.defineProperty(t, "a", { value: 60, writable: true, enumerable: true, configurable: true }); return x + ":" + t.a; }
function reflected(t: P) { const x = t.a; Reflect.set(t, "a", 70); return x + ":" + t.a; }
function calledBack(t: P, list: number[]) { const x = t.a; list.forEach(v => { t.a += v; }); return x + ":" + t.a; }
function sorted(t: P, list: number[]) { const x = t.a; list.sort((p, q) => { t.a++; return p - q; }); return x + ":" + (t.a > x); }
// A conversion that runs code.
function converted(t: P, o: any) { const x = t.a; const y = +o; return x + ":" + y + ":" + t.a; }
function concatenated(t: P, o: any) { const x = t.a; const y = "" + o; return x + ":" + y + ":" + t.a; }
// Handlers.
function thrower(t: P) { t.a = 777; throw new Error("after the store"); }
function handled(t: P) { const x = t.a; try { thrower(t); } catch { return x + ":" + t.a; } return "no"; }
function handledRead(t: P | undefined, u: P) { let x = u.a; try { u.a = 5; x = t!.a; } catch { } return x + ":" + u.a; }
// Variables of an environment and of the module.
function environment() { let v = 1; const inc = () => { v += 1; }; const x = v; inc(); const y = v; inc(); return x + ":" + y + ":" + v; }
let moduleLevel = 1;
function raise() { moduleLevel *= 2; }
function moduleVariable() { const x = moduleLevel; raise(); const y = moduleLevel; moduleLevel = y + 1; return x + ":" + y + ":" + moduleLevel; }
// A suspension.
async function suspended(t: P) { const x = t.a; await null; return x + ":" + t.a; }
function* yielded(t: P) { const x = t.a; yield x; yield t.a; }

const t0 = fresh(); log.push(sameValue(t0));
const t1 = fresh(); log.push(alias(t1, t1), alias(fresh(), fresh()));
const t2 = fresh(); t2.next = t2; log.push(viaNext(t2)); const t3 = fresh(); t3.next = fresh(); log.push(viaNext(t3));
log.push(callBetween(shared), callBetween(fresh()), callOfValue(shared, bump), callOfValue(shared, () => { }));
log.push(oneArm(fresh(), true), oneArm(fresh(), false), loop(fresh(), 0), loop(fresh(), 3), loopCall(shared, 2), loopCall(fresh(), 2), freshInLoop(4));
log.push(getter(new Counter()), setter(new Counter()), inherited(new (Made as any)()), untyped({ a: 4 }), untyped(proxy), untyped(new Counter()));
const t4 = fresh(); t4.opt = 3; log.push(deleted(t4), added(fresh()), addedByName(fresh(), "opt"), addedByName(fresh(), "other"));
log.push(assigned(fresh()), defined(fresh()), reflected(fresh()), calledBack(fresh(), [1, 2, 3]), sorted(fresh(), [3, 1, 2]));
const t5 = fresh(); log.push(converted(t5, { valueOf() { t5.a = 31; return 4; } }), concatenated(t5, { toString() { t5.a = 32; return "s"; } }), converted(fresh(), 5));
log.push(handled(fresh()), handledRead(undefined, fresh()), handledRead(fresh(), fresh()), environment(), moduleVariable(), moduleVariable());
const t6 = fresh(); const pending = suspended(t6); t6.a = 41;
const t7 = fresh(); const it = yielded(t7); const first = it.next().value; t7.a = 42; log.push(first + ":" + it.next().value);
pending.then(v => { log.push(v); console.log(log.join("\n")); });
export {};
