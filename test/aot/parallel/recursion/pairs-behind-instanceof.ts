// Functions in variables that call themselves walk lists of pairs behind instanceof. Then pairs, the constructor function and its prototype change under them.
const said: string[] = [];
function Pair(this: any, car: any, cdr: any): void { this.car = car; this.cdr = cdr; }
function Other(this: any, car: any, cdr: any): void { this.car = car; this.cdr = cdr; this.other = true; }
function Heir(this: any, car: any, cdr: any): void { (Pair as any).call(this, car, cdr); this.heir = 1; }
Heir.prototype = Object.create(Pair.prototype); Heir.prototype.constructor = Heir;
const make = (car: any, cdr: any): any => new (Pair as any)(car, cdr);
const original: any = Pair.prototype;
let size: (x: any) => number, same: (x: any, y: any) => boolean, copy: (x: any) => any, unify: (x: any, y: any) => any, bound: any = null, count = 0;
size = function (x) { count++; if (!(x instanceof (Pair as any))) return 1; return size(x.car) + size(x.cdr); };
copy = function (x) { if (x instanceof (Pair as any)) return new (Pair as any)(copy(x.car), x.cdr === null ? null : copy(x.cdr)); return x; };
same = function (x, y) {
  if (!(y instanceof (Pair as any))) return x === y;
  if (!(x instanceof (Pair as any))) return false;
  if (x.car === y.car) {
    let a = x.cdr, b = y.cdr;
    while (true) { if (a === null) return b === null; if (b === null) return false; if (same(a.car, b.car) !== false) { a = a.cdr; b = b.cdr; } else return false; }
  }
  return same(x.car, y.car) && same(x.cdr, y.cdr);
};
unify = function (x, y) { if (!(y instanceof (Pair as any))) { bound = new (Pair as any)(new (Pair as any)(y, x), bound); return true; } else if (!(x instanceof (Pair as any))) return false; else if (x.car === y.car) return unify(x.cdr, y.cdr); else return false; };
let depth = 0;
function show(x: any): string { if (depth > 9) return "deep"; depth++; try { if (Object.is(x, -0)) return "-0"; if (typeof x === "string") return JSON.stringify(x); if (x === null || typeof x !== "object") return String(x); return "{" + Object.keys(x).map(k => k + ":" + show(x[k])).join() + "}"; } catch (e) { return (e as Error).name; } finally { depth--; } }
function look(name: string, x: any): void {
  const line: string[] = [name];
  for (const act of [() => size(x), () => show(copy(x)), () => same(x, x), () => same(x, copy(x)), () => same(x, make(1, null)), () => { bound = null; return show(unify(x, make(1, make("a", "v")))) + show(bound); }, () => x instanceof (Pair as any), () => count]) { let answer: string; try { answer = show(act()); } catch (e) { answer = (e as Error).name; } line.push(answer); }
  console.log(line.join(" "), said.splice(0).join());
}
const list = (): any => make(1, make("a", make(make(2, null), make(-0, null))));
for (let turn = 0; turn < 3; turn++) { look("list", list()); look("leaf", 5); look("null", null); look("text", "pair"); look("heir", new (Heir as any)(1, make("a", null))); look("other", new (Other as any)(1, null)); }
look("literal", { car: 1, cdr: null });
look("created", Object.assign(Object.create(Pair.prototype), { car: 1, cdr: make(3, null) }));
look("constructed", Reflect.construct(Pair as any, [1, null], Other as any));
look("proxy", new Proxy(list(), {}));
{ const x = list(); Object.freeze(x); look("frozen", x); x.cdr.extra = 1; look("extra", x); delete x.cdr.car; look("deleted", x); Object.setPrototypeOf(x.cdr.cdr, null); look("cut", x); }
{ const x = list(); Object.defineProperty(x, "car", { get() { said.push("read"); return 1; } }); look("accessor", x); }
{ const x = list(); Object.setPrototypeOf(x.cdr, Other.prototype); look("moved", x); }
(Pair.prototype as any).late = 1; look("late", list());
Object.defineProperty(Pair, Symbol.hasInstance, { value: (x: any) => { said.push("asked"); return x !== null && typeof x === "object" && "car" in x; }, configurable: true }); look("asked", make(1, { car: 2, cdr: null })); delete (Pair as any)[Symbol.hasInstance]; look("not asked", make(1, { car: 2, cdr: null }));
Pair.prototype = { kind: "other" }; look("replaced", list()); { const old = Object.assign(Object.create(original), { car: 1, cdr: null }); look("old", old); } Pair.prototype = original; look("back", list());
Object.setPrototypeOf(Pair.prototype, { up: 1 }); look("above", list());
Object.defineProperty(Pair.prototype, "cdr", { get() { said.push("get"); return null; }, set(v) { said.push("set " + show(v)); }, configurable: true }); look("setter", list()); delete (Pair.prototype as any).cdr; look("no setter", list());
const old = size; size = function (x) { return old(x) * 10; }; look("other function", list());
