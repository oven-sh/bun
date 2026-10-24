// Each evaluation of a class creates its own private names, even where two names have one spelling.
function said(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }
function show(...parts: unknown[]): void { console.log(parts.join(" | ")) }

function makeBox(tag: string) {
  return class Box {
    shown: string = tag
    #value: string = tag
    #method(): string { return "m" + this.#value }
    get #accessor(): string { return "a" + this.#value }
    static #count: number = 0
    static has(o: object): string { return [#value in o, #method in o, #accessor in o].join() }
    static hasStatic(o: object): boolean { return #count in o }
    static read(o: any): string { return said(() => o.#value + o.#method() + o.#accessor) }
    static method(o: any): unknown { return o.#method }
    static increment(): number { return ++Box.#count }
  }
}
type Constructor = new (...args: any[]) => object
const Tagged = <T extends Constructor>(Base: T) => class extends Base {
  #id: number = 1
  static has(o: object): boolean { return #id in o }
  bump(): number { return ++this.#id }
}
class Single {
  #value: string = "s"
  static has(o: object): boolean { return #value in o }
}
class Outer {
  #x: number = 1
  static read(o: any): string { return said(() => o.#x) }
  static Inner = class {
    #x: number = 2
    static read(o: any): string { return said(() => o.#x) }
  }
}

const A = makeBox("a"), B = makeBox("b")
const boxes: [string, typeof A][] = [["A", A], ["B", B]]
const values: [string, object][] = [["new A()", new A()], ["new B()", new B()], ["A", A], ["B", B], ["new Single()", new Single()]]
for (const [boxName, X] of boxes) {
  for (const [title, o] of values) show(boxName, title, X.has(o), X.read(o), X.hasStatic(o), Single.has(o))
}
show("one method per evaluation", A.method(new A()) === A.method(new A()), A.method(new A()) === B.method(new B()))
show("one static field per evaluation", A.increment(), A.increment(), B.increment())

const classes: any[] = []
for (let i = 0; i < 3; i++) classes.push(class { #n: number = i; static get(o: any) { return said(() => o.#n) } })
for (let j = 0; j < 3; j++) show("class " + j + " of a loop", classes[j].get(new classes[0]()), classes[j].get(new classes[1]()), classes[j].get(new classes[2]()))

const Inner = Tagged(Object), Both = Tagged(Inner), Apart = Tagged(Object), both = new Both()
show("two fields of one spelling", Inner.has(both), Both.has(both), Apart.has(both))
show(
  "each field counts alone",
  Inner.prototype.bump.call(both),
  Both.prototype.bump.call(both),
  Inner.prototype.bump.call(both),
  Both.prototype.bump.call(both),
  said(() => Apart.prototype.bump.call(both)),
)
show("nested classes", Outer.read(new Outer()), Outer.read(new Outer.Inner()), Outer.Inner.read(new Outer()), Outer.Inner.read(new Outer.Inner()))
export {}
