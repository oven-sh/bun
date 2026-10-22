// A typed object with an accessor or a read-only value under an index is the prototype of arrays, of ordinary objects and of other typed objects. The definition comes
// before or after the object becomes a prototype, and before or after the heir has elements of its own. A store to a hole of the heir finds what the prototype has.
function outcome(f: () => unknown): string { try { return JSON.stringify(f()) ?? "undefined" } catch (e) { return "throws " + (e as Error).name } }
function show(label: string, ...parts: unknown[]): void { console.log(label + ": " + parts.map(String).join(" | ")) }

class Base {
  [index: number]: unknown
  seen: string[] = []
  constructor(public tag: string) {}
}
type Rec = { tag: string, seen: string[], [index: number]: unknown }
class Heir { [index: number]: unknown; constructor(public own: number) {} }

const text: any = (0, eval)(`({
  store(o, i, v) { o[i] = v; return o[i]; },
  storeStrict(o, i, v) { "use strict"; o[i] = v; return o[i]; },
  push(a, v) { return Array.prototype.push.call(a, v); },
})`)

const prototypes: [string, () => Base | Rec][] = [
  ["instance", () => new Base("base")],
  ["literal", (): Rec => ({ tag: "rec", seen: [] })],
]
const definitions: [string, (p: any) => void][] = [
  ["accessor", p => { Object.defineProperty(p, 2, { configurable: true, get() { return "inherited " + (this === p) }, set(v) { p.seen.push("set " + v + " on " + (this === p ? "the prototype" : Array.isArray(this) ? "an array" : "an heir")) } }) }],
  ["read-only value", p => { Object.defineProperty(p, 2, { configurable: true, value: "fixed", writable: false }) }],
  ["frozen element", p => { p[2] = "frozen"; Object.freeze(p) }],
]
const heirs: [string, () => any][] = [
  ["array of integers", () => [1, 2]],
  ["array of fractions", () => [1.5, 2.5]],
  ["array of objects", () => [{}, "text"]],
  ["empty array", () => []],
  ["array with a hole", () => [1, , , 4]],
  ["ordinary object", () => JSON.parse('{"0":"a","1":"b"}')],
  ["ordinary object without elements", () => JSON.parse('{"k":1}')],
  ["typed object", () => new Heir(1)],
  ["typed object with elements", () => { const h = new Heir(1); h[0] = "a"; h[1] = "b"; return h }],
]
function storeTyped(a: unknown[], i: number, v: unknown): unknown { a[i] = v; return a[i] }
function storeUntyped(o: any, i: any, v: any): any { o[i] = v; return o[i] }

for (const [prototypeKind, createPrototype] of prototypes) {
  for (const [definition, define] of definitions) {
    for (const [heirKind, createHeir] of heirs) {
      for (const order of ["defined first", "linked first"]) {
        const label = [prototypeKind, definition, heirKind, order].join(", ")
        const results: string[] = []
        for (const store of [storeUntyped, text.store, text.storeStrict, storeTyped]) {
          const p = createPrototype()
          const heir = createHeir()
          if (store === storeTyped && !Array.isArray(heir)) continue
          if (order === "defined first") { define(p); Object.setPrototypeOf(heir, p) } else { Object.setPrototypeOf(heir, p); define(p) }
          results.push([outcome(() => heir[2]), outcome(() => store(heir, 2, "stored")), outcome(() => Object.hasOwn(heir, 2)), outcome(() => store(heir, 3, "beside")), outcome(() => Object.keys(heir).join()), p.seen.join(), p.tag].join(" "))
        }
        show(label, ...results)
      }
    }
  }
}

// The heir of an heir, and a prototype that gets its own prototype late.
{
  const top = new Base("top")
  const middle: Rec = { tag: "middle", seen: [] }
  const list: unknown[] = [0, 1]
  Object.setPrototypeOf(list, middle)
  list[5] = "before"
  Object.setPrototypeOf(middle, top)
  Object.defineProperty(top, 3, { get() { return "from the top" }, set(v) { top.seen.push(String(v)) } })
  list[3] = "caught"
  show("two levels", JSON.stringify(list), list.length, list[3], top.seen.join(), Object.hasOwn(list, 3), middle[3], middle.tag, top.tag)
  show("push and fill", text.push(list, "pushed"), outcome(() => Array.prototype.fill.call(list, "f", 2, 5)), JSON.stringify(Object.keys(list)), top.seen.join())
}

// Arrays that have nothing to do with the object stay as they were.
{
  const p = new Base("apart")
  Object.setPrototypeOf([], p)
  Object.defineProperty(p, 0, { set() { throw new Error("never") } })
  const other: number[] = []
  for (let i = 0; i < 100; i++) other[i] = i
  show("other arrays", other.length, other[0], other[99], [1, 2, 3].map(x => x * 2).join())
}
export {}
