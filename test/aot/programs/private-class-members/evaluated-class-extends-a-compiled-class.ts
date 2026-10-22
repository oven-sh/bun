// A class in evaluated text extends a compiled class and has private fields, methods, accessors and static brand tests. Its instances are objects that the compiled
// constructor made: typed code goes on reading and writing their fields, and keys, JSON, spread and structuredClone see no private name.
function outcome(f: () => unknown): string { try { return JSON.stringify(f()) ?? "undefined" } catch (e) { return "throws " + (e as Error).name } }
function show(label: string, ...parts: unknown[]): void { console.log(label + ": " + parts.map(String).join(" | ")) }

class Point {
  #id: number
  static #count = 0
  constructor(public x: number, public y: number) { this.#id = ++Point.#count }
  #scaled(by: number): number { return (this.x + this.y) * by }
  sum(): number { return this.x + this.y }
  id(): number { return this.#id }
  twice(): number { return this.#scaled(2) }
  move(dx: number, dy: number): this { this.x += dx; this.y += dy; return this }
  static is(o: unknown): boolean { return typeof o === "object" && o !== null && #id in o && #scaled in o }
}
class Point3 extends Point {
  constructor(x: number, y: number, public z: number) { super(x, y) }
  override sum(): number { return super.sum() + this.z }
}

const derive: any = (0, eval)(`(Base, ...rest) => class Derived extends Base {
  #field = "field";
  #counter = 0;
  static #made = 0;
  constructor(...args) { super(...args, ...rest); Derived.#made++; }
  #method() { return "method " + this.#field + " " + this.sum(); }
  get #accessor() { return "accessor " + this.#counter; }
  set #accessor(v) { this.#counter = v; }
  static #staticMethod(o) { return #method in o; }
  call() { return this.#method(); }
  read() { return this.#field; }
  write(v) { this.#field = v; return this; }
  count() { this.#accessor = this.#counter + 1; return this.#accessor; }
  static hasField(o) { return #field in o; }
  static hasMethod(o) { return Derived.#staticMethod(o); }
  static hasAccessor(o) { return #accessor in o; }
  static made() { return Derived.#made; }
  static readOf(o) { return o.#field; }
  static callOf(o) { return o.#method(); }
}`)

function sumTyped(p: Point): number { return p.x + p.y + p.sum() + p.twice() }
function moveTyped(p: Point): Point { p.x = p.x + 1; p.y = p.y * 2; return p.move(1, 1) }
function seen(o: any): string {
  return [Reflect.ownKeys(o).join(), Object.keys(o).join(), JSON.stringify(o), JSON.stringify({ ...o }), outcome(() => structuredClone(o)), JSON.stringify(Object.getOwnPropertyDescriptors(o)), Object.entries(o).join(";")].join(" ; ")
}

for (const [name, Base, args] of [["Point", Point, [1, 2]], ["Point3", Point3, [1, 2, 3]]] as const) {
  const A = derive(Base)
  const B = derive(Base)
  const a = new A(...args)
  const b = new B(...args)
  const plain = new (Base as any)(...args)
  show(name + ", members", a.call(), a.read(), a.write("again").read(), a.count(), a.count(), a.call())
  show(name + ", brands of its own class", A.hasField(a), A.hasMethod(a), A.hasAccessor(a), A.made())
  show(name + ", brands of the other class", B.hasField(a), B.hasMethod(a), B.hasAccessor(a), A.hasField(b), A.hasMethod(b), A.hasField(plain), A.hasMethod(plain), A.hasField({}), outcome(() => A.hasField(1)))
  show(name + ", wrong receivers", outcome(() => A.readOf(b)), outcome(() => A.callOf(b)), outcome(() => A.readOf(plain)), outcome(() => A.callOf(plain)), outcome(() => A.prototype.count.call(plain)), outcome(() => A.prototype.write.call(b, 1)))
  show(name + ", the compiled class", Point.is(a), Point.is(b), Point.is(plain), a.id() < b.id(), a instanceof Base, a instanceof A, a instanceof B, a.twice())
  show(name + ", typed code", sumTyped(a), sumTyped(moveTyped(a)), a.x, a.y, a.call(), sumTyped(plain))
  show(name + ", what is seen", seen(a))
  a.added = "added"
  delete a.y
  a.y = 9
  Object.defineProperty(a, "x", { get() { return 100 }, enumerable: true, configurable: true })
  show(name + ", altered", seen(a), a.call(), sumTyped(a), A.hasField(a), A.hasMethod(a), Point.is(a))
  Object.freeze(b)
  show(name + ", frozen", Object.isFrozen(b), b.write("in a frozen object").read(), b.count(), b.call(), outcome(() => moveTyped(b)), seen(b))
}

// A class of evaluated text puts its private names on a finished object, also on one that cannot be extended.
const stamp: any = (0, eval)(`(() => {
  class Returns { constructor(o) { return o; } }
  return class Stamp extends Returns { #mark = 1; #m() { return this.#mark; } static bump(o) { return ++o.#mark + o.#m(); } static has(o) { return #mark in o && #m in o; } };
})()`)
type Pair = { left: number, right: string }
function leftOf(p: Pair): number { return p.left }
for (const [name, create] of [["literal", (): Pair => ({ left: 1, right: "r" })], ["frozen literal", (): Pair => Object.freeze({ left: 1, right: "r" })], ["sealed instance", () => Object.seal(new Point(1, 2))]] as const) {
  const o: any = create()
  show(name, stamp.has(o), outcome(() => stamp.bump(o)), new stamp(o) === o, stamp.has(o), stamp.bump(o), stamp.bump(o), outcome(() => new stamp(o)), seen(o), "left" in o ? leftOf(o) : sumTyped(o), Object.isFrozen(o), Object.isSealed(o))
}

const D = derive(Point)
const many: Point[] = []
for (let i = 0; i < 300; i++) many.push(i % 2 ? new D(i, 1) : new Point(i, 1))
let total = 0, branded = 0
for (const p of many) { total += sumTyped(p); if (D.hasMethod(p)) branded++ }
show("300 through one site", total, branded, D.made())
export {}
