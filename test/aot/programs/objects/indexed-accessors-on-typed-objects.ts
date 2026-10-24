// A getter, a setter and a read-only value under an index, on an instance of a class and on a typed literal. Typed code, untyped code and evaluated text read and
// write the index and the fields afterward. The getter and the setter run with the object itself as `this`.
function outcome(f: () => unknown): string { try { return JSON.stringify(f()) ?? "undefined" } catch (e) { return "throws " + (e as Error).name } }
function show(label: string, ...parts: unknown[]): void { console.log(label + ": " + parts.map(String).join(" | ")) }

class Row {
  [index: number]: unknown
  log: string[] = []
  constructor(public name: string, public size: number) {}
  describe(): string { return this.name + "/" + this.size }
}
type Rec = { name: string, size: number, log: string[], [index: number]: unknown }

const text: any = (0, eval)(`({
  read(o, i) { return o[i]; },
  write(o, i, v) { "use strict"; o[i] = v; return o[i]; },
  writeSloppy: new Function("o", "i", "v", "o[i] = v; return o[i];"),
  fields(o) { return o.name + "/" + o.size; },
  setFields(o, name, size) { o.name = name; o.size = size; },
  has(o, i) { return [i in o, Object.hasOwn(o, i), Object.prototype.propertyIsEnumerable.call(o, i)].join(); },
  remove(o, i) { return delete o[i]; },
})`)

function readTyped(o: Row | Rec, i: number): unknown { return o[i] }
function writeTyped(o: Row | Rec, i: number, v: unknown): unknown { o[i] = v; return o[i] }
function fieldsTyped(o: Row | Rec): string { return o.name + "/" + o.size }
function setFieldsTyped(o: Row | Rec, name: string, size: number): void { o.name = name; o.size = size }
function readUntyped(o: any, i: any): any { return o[i] }
function writeUntyped(o: any, i: any, v: any): any { o[i] = v; return o[i] }
function fieldsUntyped(o: any): any { return o.name + "/" + o.size }

const definitions: [string, (o: any) => void][] = [
  ["getter", o => { Object.defineProperty(o, 1, { configurable: true, enumerable: true, get() { this.log.push("get " + (this === o)); return "got" } }) }],
  ["setter", o => { Object.defineProperty(o, 1, { configurable: true, enumerable: false, set(v) { this.log.push("set " + v + " " + (this === o)) } }) }],
  ["getter and setter", o => { let kept: unknown = "first"; Object.defineProperty(o, 1, { configurable: false, enumerable: true, get() { this.log.push("get " + (this === o)); return kept }, set(v) { this.log.push("set " + (this === o)); kept = v; this.size++ } }) }],
  ["read-only value", o => { Object.defineProperty(o, 1, { configurable: true, enumerable: true, writable: false, value: "fixed" }) }],
  ["value with default attributes", o => { Object.defineProperty(o, 1, { value: "hidden" }) }],
  ["an element made read-only", o => { o[1] = "plain"; Object.defineProperty(o, 1, { writable: false }) }],
  ["an element made an accessor", o => { o[0] = "zero"; o[1] = "plain"; o[2] = "two"; Object.defineProperty(o, 1, { get() { return "was plain " + (this === o) } }) }],
  ["by defineProperties", o => { Object.defineProperties(o, { 1: { get() { return this.name }, enumerable: true, configurable: true }, 3: { value: 3 } }) }],
  ["by Reflect.defineProperty", o => { Reflect.defineProperty(o, "1", { get() { return this.size }, set(v) { this.size = String(v).length }, configurable: true }) }],
  ["by __defineGetter__", o => { o.__defineGetter__(1, function (this: any) { return "old " + (this === o) }) }],
  ["a large index", o => { Object.defineProperty(o, 4294967294, { get() { return "large " + (this === o) }, enumerable: true, configurable: true }); Object.defineProperty(o, 1, { get() { return o[4294967294] }, configurable: true }) }],
]

const kinds: [string, () => Row | Rec][] = [
  ["instance", () => new Row("row", 1)],
  ["literal", (): Rec => ({ name: "rec", size: 1, log: [] })],
]

function after(o: Row | Rec): string {
  const copy: any = { ...o }
  return [
    Reflect.ownKeys(o).join(), Object.keys(o).join(), JSON.stringify(o), Object.keys(copy).join(), JSON.stringify(copy),
    outcome(() => structuredClone({ ...o, log: [] })), JSON.stringify(Object.getOwnPropertyDescriptor(o, 1), (_, v) => typeof v === "function" ? "function" : v),
    o instanceof Row ? o.describe() : "no class", Object.entries(o).length,
  ].join(" ; ")
}

for (const [kind, create] of kinds) {
  for (const [name, define] of definitions) {
    const label = kind + ", " + name
    for (const [by, read, write, fields] of [["typed", readTyped, writeTyped, fieldsTyped], ["untyped", readUntyped, writeUntyped, fieldsUntyped], ["text", text.read, text.write, text.fields], ["sloppy text", text.read, text.writeSloppy, text.fields]] as const) {
      const o = create()
      const before = fields(o)
      define(o)
      show(label + ", " + by, before, outcome(() => read(o, 1)), outcome(() => write(o, 1, "stored")), outcome(() => read(o, 1)), outcome(() => read(o, by === "typed" ? 1 : "1")), outcome(() => read(o, 2)), fields(o), o.log.join())
    }
    const o = create()
    define(o)
    setFieldsTyped(o, "typed", 10)
    const first = fieldsTyped(o) + " " + fieldsUntyped(o) + " " + text.fields(o)
    text.setFields(o, "text", 20)
    show(label + ", fields", first, fieldsTyped(o), fieldsUntyped(o), text.fields(o), text.has(o, 1), text.has(o, 2))
    show(label + ", afterward", after(o))
    show(label + ", removed", outcome(() => text.remove(o, 1)), outcome(() => readTyped(o, 1)), Reflect.ownKeys(o).join(), fieldsTyped(o))
  }
}

function total(rows: Row[]): number { let n = 0; for (const row of rows) n += row.size; return n }
const rows: Row[] = []
for (let i = 0; i < 300; i++) {
  const row = new Row("r" + i, i)
  if (i % 3 === 0) Object.defineProperty(row, 0, { get() { return this.size * 2 }, set(v) { this.size = v }, configurable: true })
  if (i % 5 === 0) Object.defineProperty(row, 7, { value: i, writable: false })
  rows.push(row)
}
let sum = 0
for (const row of rows) { const doubled = row[0]; if (typeof doubled === "number") sum += doubled; row[0] = row.size + 1 }
show("300 through one site", total(rows), sum, rows[3][0], rows[4][0], rows[5][7], rows[6].describe())
export {}
