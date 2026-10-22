interface Inner { d: number; e: number }
interface Outer { b: number; c?: Inner }
function make(i: number): Outer { return { b: i, c: { d: i + 1, e: i + 2 } }; }
const a = make(1); const x = a.c!;
delete a.c;
console.log("c" in a, a.c, x.d, Object.keys(a).join());
a.c = x;
console.log(a.c === x, Object.keys(a).join());
const r = make(2); const y = r.c!;
Object.defineProperty(r, "c", { get() { return "got"; }, configurable: true, enumerable: true });
console.log((r as any).c, y.e, JSON.stringify(r));
const f = Object.freeze(make(3));
try { (f as any).c = null; } catch (e) { console.log("threw", (e as Error).constructor.name); }
f.c!.d = 50;
console.log(Object.isFrozen(f), Object.isFrozen(f.c), f.c!.d);
const g = make(4); Object.freeze(g.c);
try { g.c!.d = 1; } catch (e) { console.log("threw", (e as Error).constructor.name); }
g.b = 9;
console.log(Object.isFrozen(g), Object.isFrozen(g.c), g.c!.d, g.b);
const s = Object.seal(make(5)); console.log(Object.isSealed(s), Object.isSealed(s.c));
delete (make(6).c as any).d;
const h = make(7); delete (h.c as any).d; (h.c as any).z = "added";
console.log(JSON.stringify(h), Object.keys(h.c!).join());
Object.setPrototypeOf(h.c, { inherited: 1 });
console.log((h.c as any).inherited, Object.getPrototypeOf(h) === Object.prototype);
