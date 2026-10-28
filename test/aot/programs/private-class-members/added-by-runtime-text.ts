// Classes evaluated from text at run time add private fields, methods and accessors to objects that compiled code created.
// COUNTER: NativeDefinition >= 1
function outcome(f: () => unknown): string { try { return JSON.stringify(f()) } catch (e) { return "throws " + (e as Error).name } }
function show(label: string, ...parts: string[]): void { console.log(label + ": " + parts.join(" | ")) }

class Point {
  #secret: number = 5
  constructor(public x: number, public y: number) {}
  #twice(): number { return this.#secret * 2 }
  sum(): number { return this.x + this.y + this.#secret + this.#twice() }
  static has(o: object): boolean { return #secret in o && #twice in o }
}
type Pair = { left: number, right: string }

const kit: any = (0, eval)(`(() => {
  class ReturnsArgument { constructor(o) { return o; } }
  class Field extends ReturnsArgument { #stamp = "stamp"; static read(o) { return o.#stamp; } static write(o, v) { o.#stamp = v; } static has(o) { return #stamp in o; } }
  class Method extends ReturnsArgument { #m() { return "method"; } static call(o) { return o.#m(); } static has(o) { return #m in o; } }
  class Accessor extends ReturnsArgument { #v = 1; get #a() { return "got " + this.#v; } set #a(v) { this.#v = v; } static get(o) { return o.#a; } static set(o, v) { o.#a = v; } }
  function derive(Base) {
    return class Derived extends Base {
      #own = 1;
      #next() { return ++this.#own; }
      next() { return this.#next(); }
      static has(o) { return #own in o && #next in o; }
    };
  }
  return { Field, Method, Accessor, derive };
})()`)

function describe(o: any): string {
  const ofClass = o instanceof Point ? o.sum() + " " + Point.has(o) : "no class"
  return [JSON.stringify(o), Reflect.ownKeys(o).join(), ofClass, Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o)].join(" ")
}

const cases: [string, () => object][] = [
  ["instance", () => new Point(1, 2)],
  ["literal", (): Pair => ({ left: 1, right: "r" })],
  ["frozen instance", () => Object.freeze(new Point(1, 2))],
  ["sealed literal", (): Pair => Object.seal({ left: 1, right: "r" })],
  ["non-extensible instance", () => Object.preventExtensions(new Point(1, 2))],
  ["instance with an added property", () => { const p: any = new Point(1, 2); p.added = 3; return p }],
]

for (const [kind, create] of cases) {
  show(kind + ", field", outcome(() => { const o = create(); new kit.Field(o); const before = kit.Field.read(o); kit.Field.write(o, "again"); return [before, kit.Field.read(o), kit.Field.has(o), describe(o)] }))
  show(kind + ", method", outcome(() => { const o = create(); new kit.Method(o); return [kit.Method.call(o), kit.Method.has(o), describe(o)] }))
  show(kind + ", accessor", outcome(() => { const o = create(); new kit.Accessor(o); const before = kit.Accessor.get(o); kit.Accessor.set(o, 2); return [before, kit.Accessor.get(o), describe(o)] }))
  show(kind + ", all three", outcome(() => { const o = create(); new kit.Method(o); new kit.Field(o); new kit.Accessor(o); return [kit.Method.call(o), kit.Field.read(o), kit.Accessor.get(o), describe(o)] }))
  show(kind + ", field twice", outcome(() => { const o = create(); new kit.Field(o); new kit.Field(o); return "no error" }))
  show(kind + ", method twice", outcome(() => { const o = create(); new kit.Method(o); new kit.Method(o); return "no error" }))
  show(kind + ", nothing added", outcome(() => kit.Field.has(create())), outcome(() => kit.Method.has(create())), outcome(() => kit.Field.read(create())), outcome(() => kit.Field.write(create(), 1)), outcome(() => kit.Method.call(create())), outcome(() => kit.Accessor.get(create())), describe(create()))
}

const Derived = kit.derive(Point)
show("derived from a compiled class", outcome(() => { const d = new Derived(3, 4); return [d.next(), d.next(), Derived.has(d), Derived.has(new Point(3, 4)), d instanceof Point, describe(d)] }))

function total(points: Point[]): number { let n = 0; for (const p of points) n += p.sum(); return n }
const points: Point[] = []
for (let i = 0; i < 300; i++) {
  const p = new Point(i, 1)
  if (i % 2 === 0) new kit.Field(p)
  if (i % 3 === 0) new kit.Method(p)
  points.push(p)
}
let right = 0
for (let i = 0; i < 300; i++) {
  if (kit.Field.has(points[i]) === (i % 2 === 0) && kit.Method.has(points[i]) === (i % 3 === 0) && Point.has(points[i])) right++
}
show("300 through one site", String(right), String(total(points)))
export {}
