// Compiled code never adds a property to these objects, so nothing in them is set aside for one. Evaluated text adds names, symbols, elements and accessors, redefines and
// deletes fields, changes the prototype and freezes. Typed code reads and writes the fields before and after, and many objects are altered so that each keeps its own.
function outcome(f: () => unknown): string { try { return JSON.stringify(f()) ?? "undefined" } catch (e) { return "throws " + (e as Error).name } }
function show(label: string, ...parts: unknown[]): void { console.log(label + ": " + parts.map(String).join(" | ")) }

class Item {
  constructor(public id: number, public label: string, public on: boolean) {}
  title(): string { return this.label + "#" + this.id + (this.on ? "+" : "-") }
}
type Entry = { id: number, label: string, on: boolean }

const alterations: Record<string, (o: any, n: number) => unknown> = (0, eval)(`({
  "a name"(o, n) { o.extra = "extra" + n; },
  "three names"(o, n) { o.p = n; o.q = n + 1; o.r = n + 2; },
  "a symbol"(o, n) { o[Symbol.for("added")] = n; },
  "an element"(o, n) { o[0] = n; },
  "an accessor"(o, n) { Object.defineProperty(o, "computed", { get() { return this.id + n; }, enumerable: true, configurable: true }); },
  "a hidden name"(o, n) { Object.defineProperty(o, "hidden", { value: n }); },
  "a name that hides a method"(o, n) { o.title = function () { return "own title " + n; }; },
  "a field becomes an accessor"(o, n) { Object.defineProperty(o, "label", { get() { return "got" + n; }, set(v) {}, enumerable: true, configurable: true }); },
  "a field becomes read-only"(o, n) { Object.defineProperty(o, "id", { writable: false }); },
  "a field holds another kind of value"(o, n) { o.id = "text" + n; o.on = { n }; },
  "a field is deleted"(o, n) { delete o.label; },
  "a field is deleted and added again"(o, n) { delete o.id; o.id = n; },
  "forty names"(o, n) { for (let i = 0; i < 40; i++) o["k" + i] = n + i; },
  "a name, then another prototype"(o, n) { o.extra = n; Object.setPrototypeOf(o, { title() { return "other " + this.extra; } }); },
  "a name, then it is a prototype"(o, n) { o.extra = n; return Object.create(o).extra; },
  "a name, then frozen"(o, n) { o.extra = n; Object.freeze(o); },
  "a name is added and deleted"(o, n) { o.extra = n; delete o.extra; },
  "assigned onto"(o, n) { Object.assign(o, { id: n, more: "more", [Symbol.for("added")]: 1 }); },
})`)

function readTyped(o: Item | Entry): string { return o.id + "," + o.label + "," + o.on }
function readUntyped(o: any): string { return o.id + "," + o.label + "," + o.on }
// Typed code is not shown a field that no longer holds what its type says.
const leavesTheTypes = new Set(["a field holds another kind of value", "a field is deleted"])
function writeTyped(o: Item | Entry, n: number): void { o.id = n; o.label = "written"; o.on = n > 5 }
function seen(o: any): string {
  return [Reflect.ownKeys(o).map(String).join(), JSON.stringify(o), JSON.stringify({ ...o }), Object.entries(o).length, typeof o.title === "function" && typeof o.label === "string" && typeof o.id === "number" ? outcome(() => o.title()) : "no title"].join(" ; ")
}

for (const [kind, create] of [["instance", (n: number) => new Item(n, "item", true)], ["literal", (n: number): Entry => ({ id: n, label: "entry", on: false })]] as const) {
  for (const [name, alter] of Object.entries(alterations)) {
    const o = create(1)
    const untouched = create(2)
    const before = readTyped(o)
    const result = alter(o, 5)
    const read = leavesTheTypes.has(name) ? readUntyped : readTyped
    show(kind + ", " + name, before, result, read(o), seen(o), outcome(() => { writeTyped(o, 7); return readTyped(o) }), seen(o), readTyped(untouched), seen(untouched))
  }
}

// Every object keeps its own additions, across collections.
const items: Item[] = []
for (let i = 0; i < 2000; i++) {
  const item = new Item(i, "n" + i, i % 2 === 0)
  if (i % 4 === 0) alterations["a name"](item, i)
  if (i % 6 === 0) alterations["an element"](item, i)
  if (i % 10 === 0) alterations["a field becomes an accessor"](item, i)
  items.push(item)
}
Bun.gc(true)
let right = 0, ids = 0
for (let i = 0; i < items.length; i++) {
  const item: any = items[i]
  ids += items[i].id
  if ((item.extra === (i % 4 === 0 ? "extra" + i : undefined)) && (item[0] === (i % 6 === 0 ? i : undefined)) && (items[i].label === (i % 10 === 0 ? "got" + i : "n" + i))) right++
}
show("2000 objects", right, ids, items[0].title(), items[1].title(), items[20].title())
export {}
