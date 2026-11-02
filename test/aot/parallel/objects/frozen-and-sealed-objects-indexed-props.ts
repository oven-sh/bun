// Object.freeze, Object.seal and Object.preventExtensions on typed objects that have elements, accessors under an index, added names and symbols.
function outcome(f: () => unknown): string { try { return JSON.stringify(f()) ?? "undefined" } catch (e) { return "throws " + (e as Error).name } }
function show(label: string, ...parts: unknown[]): void { console.log(label + ": " + parts.map(String).join(" | ")) }

class Row { [index: number]: unknown; constructor(public name: string, public size: number) {} }
type Rec = { name: string, size: number, [index: number]: unknown }
const mark = Symbol("mark")
const strict: any = (0, eval)(`({ store(o, k, v) { "use strict"; o[k] = v; return o[k]; }, remove(o, k) { "use strict"; return delete o[k]; } })`)

const kinds: [string, () => any][] = [["instance", () => new Row("row", 1)], ["literal", (): Rec => ({ name: "rec", size: 1 })]]
const contents: [string, (o: any) => void][] = [
  ["nothing more", () => {}],
  ["elements", o => { o[0] = "a"; o[1] = 1.5; o[2] = {} }],
  ["a sparse element", o => { o[0] = "a"; o[100000] = "far" }],
  ["an accessor under an index", o => { o[0] = "a"; Object.defineProperty(o, 1, { get() { return this.name }, set(v) { this.size = v }, configurable: true, enumerable: true }) }],
  ["a read-only element", o => { Object.defineProperty(o, 1, { value: "fixed", configurable: true, enumerable: true }) }],
  ["elements, a name and a symbol", o => { o[0] = "a"; o.added = "b"; o[mark] = "c" }],
]
const levels: [string, (o: object) => void][] = [["frozen", Object.freeze], ["sealed", Object.seal], ["not extensible", Object.preventExtensions]]

function describe(o: any): string {
  const descriptors = Object.getOwnPropertyDescriptors(o)
  return Reflect.ownKeys(descriptors).map(key => {
    const d = (descriptors as any)[key]
    return String(key) + ":" + ("value" in d ? "v" : "a") + (d.writable ? "w" : "") + (d.enumerable ? "e" : "") + (d.configurable ? "c" : "")
  }).join() + " " + [Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o)].join()
}

for (const [kind, create] of kinds) {
  for (const [content, fill] of contents) {
    for (const [level, apply] of levels) {
      const o = create()
      fill(o)
      apply(o)
      show([kind, content, level].join(", "), describe(o),
        outcome(() => strict.store(o, 0, "again")), outcome(() => strict.store(o, 1, 7)), outcome(() => strict.store(o, 5, "new")), outcome(() => strict.store(o, "name", "other")),
        outcome(() => strict.remove(o, 0)), outcome(() => strict.remove(o, 1)), outcome(() => strict.remove(o, "size")),
        outcome(() => Object.defineProperty(o, 0, { get() { return 1 } }) === o), outcome(() => Object.defineProperty(o, 9, { value: 1 }) === o),
        JSON.stringify(o), o.name, o.size, describe(o))
    }
  }
}
export {}
