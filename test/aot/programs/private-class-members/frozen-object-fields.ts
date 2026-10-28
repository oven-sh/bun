// Private fields of frozen, sealed and non-extensible objects stay writable, and private elements can still be added to such objects. A frozen array is the exception: JavaScriptCore refuses to add a private element to it, in plain Bun and in compiled code.
// COUNTER: UseAsPrototype >= 1
// COUNTER: DeleteOfRequiredField >= 1
// COUNTER: RedefinedProperty = 0
type Change = (o: any) => void
function said(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }
function show(...parts: unknown[]): void { console.log(parts.join(" | ")) }

class Identity { constructor(o: any) { return o } }
class Counter {
  shown: number = 1
  #count: number = 0
  #text: string = "a"
  #box: { n: number } | null = null
  #maybe: number | undefined = undefined
  get #twice(): number { return this.#count * 2 }
  set #twice(v: number) { this.#count = v / 2 }
  bump(): number { return ++this.#count }
  viaAccessor(): number { this.#twice = 10; return this.#twice }
  write(text: string): string { this.#text += text; this.#box = { n: this.#count }; this.#maybe = this.#count; return this.#text + this.#box.n + this.#maybe }
  publicStore(): string { return said(() => ++this.shown) }
  static has(o: object): boolean { return #count in o && #twice in o }
}
class Stamp extends Identity {
  #mark: number = 1
  #touch(): number { return ++this.#mark }
  static has(o: object): boolean { return #mark in o && #touch in o }
  static touch(o: object): number { return (o as Stamp).#touch() }
}

const children: object[] = []
const levels: [string, Change][] = [["freeze", Object.freeze], ["seal", Object.seal], ["preventExtensions", Object.preventExtensions]]
const states: [string, (o: Counter, level: Change) => void][] = [
  ["with its layout", (o, level) => { level(o) }],
  ["ordinary, then the level", (o, level) => { delete (o as any).shown; level(o) }],
  ["the level, then ordinary", (o, level) => { level(o); children.push(Object.create(o)) }],
]
function report(level: string, state: string, o: Counter): void {
  show(level, state, o.bump(), o.bump(), o.write("b"), o.viaAccessor(), o.publicStore(), Counter.has(o), Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o), Reflect.ownKeys(o).join(), JSON.stringify(o))
}

report("no level", "with its layout", new Counter())
for (const [levelName, level] of levels) {
  for (const [state, apply] of states) {
    const o = new Counter()
    apply(o, level)
    report(levelName, state, o)
  }
}
show("below a Counter", children.map(child => Counter.has(child)).join())

const ordinary = new Counter()
delete (ordinary as any).shown
const targets: [string, object][] = [
  ["a frozen Counter with its layout", Object.freeze(new Counter())],
  ["a frozen Counter that is ordinary", Object.freeze(ordinary)],
  ["a frozen record", Object.freeze({ a: 1 } as { a: number })],
  ["a frozen array", Object.freeze([1])],
]
for (const [title, target] of targets) {
  const stamp = () => said(() => { new Stamp(target); return "stamped" })
  show(title, stamp(), Stamp.has(target), said(() => Stamp.touch(target)), said(() => Stamp.touch(target)), stamp(), Object.isFrozen(target), Reflect.ownKeys(target).length)
}
show("a Counter without a stamp", Stamp.has(new Counter()), said(() => Stamp.touch(new Counter())))
export {}
