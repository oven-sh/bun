// Functions in variables that call themselves walk lists of pairs behind instanceof. Then pairs, the constructor function and its prototype change under them.
const said: string[] = [];
function Pair(this: any, front: any, tail: any): void { this.tail = tail; this.front = front; }
function Other(this: any, front: any, tail: any): void { this.tail = tail; this.front = front; this.other = true; }
function Heir(this: any, front: any, tail: any): void { (Pair as any).call(this, front, tail); this.heir = 1; }
Heir.prototype = Object.create(Pair.prototype); Heir.prototype.constructor = Heir;
const make = (front: any, tail: any): any => new (Pair as any)(front, tail);
const original: any = Pair.prototype;
let size: (x: any) => number, same: (x: any, y: any) => boolean, copy: (x: any) => any, unlike: (x: any, y: any) => number, bound: any = null, count = 0;
size = function (x) { count++; if (!(x instanceof (Pair as any))) return 1; return size(x.front) + size(x.tail); };
copy = function (x) { if (x instanceof (Pair as any)) return new (Pair as any)(copy(x.front), x.tail === null ? null : copy(x.tail)); return x; };
same = function (x, y) {
  if (x instanceof (Pair as any) && y instanceof (Pair as any)) return same(x.tail, y.tail) && same(x.front, y.front);
  return Object.is(x, y);
};
unlike = function (x, y) {
  if (x instanceof (Pair as any) && y instanceof (Pair as any)) { const below = unlike(x.tail, y.tail); return below + unlike(x.front, y.front); }
  if (x === y) return 0;
  bound = new (Pair as any)(x, new (Pair as any)(y, bound));
  return 1;
};
let depth = 0;
function show(x: any): string { if (depth > 9) return "deep"; depth++; try { if (Object.is(x, -0)) return "-0"; if (typeof x === "string") return JSON.stringify(x); if (x === null || typeof x !== "object") return String(x); return "{" + Object.keys(x).map(k => k + ":" + show(x[k])).join() + "}"; } catch (e) { return (e as Error).name; } finally { depth--; } }
function look(name: string, x: any): void {
  const line: string[] = [name];
  for (const act of [() => size(x), () => show(copy(x)), () => same(x, x), () => same(x, copy(x)), () => same(x, make(1, null)), () => { bound = null; return show(unlike(x, make(1, make("a", "v")))) + show(bound); }, () => x instanceof (Pair as any), () => count]) { let answer: string; try { answer = show(act()); } catch (e) { answer = (e as Error).name; } line.push(answer); }
  console.log(line.join(" "), said.splice(0).join());
}
const list = (): any => make(1, make("a", make(make(2, null), make(-0, null))));
for (let turn = 0; turn < 3; turn++) { look("list", list()); look("leaf", 5); look("null", null); look("text", "pair"); look("heir", new (Heir as any)(1, make("a", null))); look("other", new (Other as any)(1, null)); }
look("literal", { front: 1, tail: null });
look("created", Object.assign(Object.create(Pair.prototype), { front: 1, tail: make(3, null) }));
look("constructed", Reflect.construct(Pair as any, [1, null], Other as any));
look("proxy", new Proxy(list(), {}));
{ const x = list(); Object.freeze(x); look("frozen", x); x.tail.extra = 1; look("extra", x); delete x.tail.front; look("deleted", x); Object.setPrototypeOf(x.tail.tail, null); look("cut", x); }
{ const x = list(); Object.defineProperty(x, "front", { get() { said.push("read"); return 1; } }); look("accessor", x); }
{ const x = list(); Object.setPrototypeOf(x.tail, Other.prototype); look("moved", x); }
(Pair.prototype as any).late = 1; look("late", list());
Object.defineProperty(Pair, Symbol.hasInstance, { value: (x: any) => { said.push("asked"); return x !== null && typeof x === "object" && "front" in x; }, configurable: true }); look("asked", make(1, { front: 2, tail: null })); delete (Pair as any)[Symbol.hasInstance]; look("not asked", make(1, { front: 2, tail: null }));
Pair.prototype = { kind: "other" }; look("replaced", list()); { const old = Object.assign(Object.create(original), { front: 1, tail: null }); look("old", old); } Pair.prototype = original; look("back", list());
Object.setPrototypeOf(Pair.prototype, { up: 1 }); look("above", list());
Object.defineProperty(Pair.prototype, "tail", { get() { said.push("get"); return null; }, set(v) { said.push("set " + show(v)); }, configurable: true }); look("setter", list()); delete (Pair.prototype as any).tail; look("no setter", list());
const old = size; size = function (x) { return old(x) * 10; }; look("other function", list());
