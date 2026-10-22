// Stores by name through a receiver of type `any` into typed fields of every representation, and the stores that a field cannot take in place.
"use strict"
interface Shape { area(): number }
class Square implements Shape { side = 2; area() { return this.side * this.side } }
class Disk implements Shape { radius = 3; area() { return 3 * this.radius * this.radius } }
class Foo { id: number; constructor(id: number) { this.id = id } }
type Mode = "idle" | "busy" | "done"
let calls = 0
const addOne = () => { calls += 1 }
const addTen = () => { calls += 10 }
function addHundred() { calls += 100 }
class Widget {
  count: number = 0
  label: string = "first"
  mode: Mode = "idle"
  enabled: boolean = false
  owner: Foo | null = null
  parts: Foo[] = []
  action: () => void = addOne
  shape: Shape = new Square()
  declare note?: string
  declare weight?: number
}
interface Options { id: number; note?: string }
interface Panel { id: number; top?: number; left?: number; width?: number; height?: number; color?: string; title?: string; hidden?: boolean; locked?: boolean; parent?: Foo; child?: Foo; order?: number; hint?: string }

function setCount(target: any, value: any) { target.count = value }
function setLabel(target: any, value: any) { target.label = value }
function setMode(target: any, value: any) { target.mode = value }
function setEnabled(target: any, value: any) { target.enabled = value }
function setOwner(target: any, value: any) { target.owner = value }
function setParts(target: any, value: any) { target.parts = value }
function setAction(target: any, value: any) { target.action = value }
function setShape(target: any, value: any) { target.shape = value }
function setNote(target: any, value: any) { target.note = value }
function setWeight(target: any, value: any) { target.weight = value }
function setOrder(target: any, value: any) { target.order = value }
function setHint(target: any, value: any) { target.hint = value }
function setChild(target: any, value: any) { target.child = value }
function getNote(target: any) { return target.note }

function show(value: any): string {
  if (typeof value === "function") return "function " + value.name
  if (Array.isArray(value)) return "[" + value.map(element => show(element)).join() + "]"
  if (value instanceof Foo) return "Foo " + value.id
  if (value instanceof Square || value instanceof Disk) return value.constructor.name + " " + value.area()
  if (typeof value === "object" && value !== null) return JSON.stringify(value)
  return typeof value + " " + (Object.is(value, -0) ? "-0" : String(value))
}
function showAll(target: any): string { return Object.keys(target).map(key => key + "=" + show(target[key])).join(" ") }
function same(texts: string[]): string { return texts.every(text => text === texts[0]) ? texts[0] : "DIFFERENT: " + texts.join(" | ") }
function attempt(title: string, run: () => string) {
  try { console.log(title + ":", run()) } catch (error) { console.log(title + ": threw", (error as Error).constructor.name) }
}

// An object from JSON.parse goes through every function too, so that no receiver has a known layout.
const parsed: any = JSON.parse("{}")
const widgets: Widget[] = []
for (let i = 0; i < 5; i++) widgets.push(new Widget())
function storeInAll(set: (target: any, value: any) => void, value: unknown) {
  for (const widget of widgets) set(widget, value)
  set(parsed, value)
}

for (const value of [1, 1.5, 2, -0, 2 ** 31, -(2 ** 31), -(2 ** 31) + 1, -(2 ** 31) + 4, -(2 ** 31) + 5, NaN, 7]) {
  storeInAll(setCount, value)
  console.log("count", same(widgets.map(widget => show(widget.count))), show(parsed.count))
}
for (const value of ["busy", "done", ["id", "le"].join(""), "busy"]) {
  storeInAll(setMode, value)
  console.log("mode", same(widgets.map(widget => show(widget.mode) + " " + (widget.mode === "idle") + " " + (widget.mode === "busy"))), show(parsed.mode))
}
for (const value of ["second", "", "done", "x".repeat(40), "<" + parsed.mode + ">", widgets.length + "th"]) {
  storeInAll(setLabel, value)
  console.log("label", same(widgets.map(widget => show(widget.label) + " " + widget.label.length)), show(parsed.label))
}
for (const value of [true, false, true]) {
  storeInAll(setEnabled, value)
  console.log("enabled", same(widgets.map(widget => show(widget.enabled) + " " + (widget.enabled ? "on" : "off"))), show(parsed.enabled))
}
for (const value of [new Foo(1), null, new Foo(2)]) {
  storeInAll(setOwner, value)
  console.log("owner", same(widgets.map(widget => show(widget.owner) + " " + (widget.owner === null ? "none" : widget.owner.id + 1))), show(parsed.owner))
}
for (const value of [[new Foo(3)], [], [new Foo(4), new Foo(5)]]) {
  storeInAll(setParts, value)
  console.log("parts", same(widgets.map(widget => show(widget.parts) + " " + widget.parts.length)), show(parsed.parts))
}
for (const value of [addTen, addHundred, addOne.bind(null), addOne]) {
  storeInAll(setAction, value)
  for (const widget of widgets) widget.action()
  console.log("action", same(widgets.map(widget => show(widget.action))), show(parsed.action), calls)
}
for (const value of [new Disk(), new Square(), new Disk()]) {
  storeInAll(setShape, value)
  console.log("shape", same(widgets.map(widget => show(widget.shape) + " " + widget.shape.area())), show(parsed.shape))
}
console.log("all", same(widgets.map(showAll)))
console.log("parsed", showAll(parsed))

attempt("string into a number field", () => {
  const widget = new Widget()
  setCount(widget, "many")
  const stored = showAll(widget)
  setCount(widget, 3)
  return stored + " then " + showAll(widget)
})
attempt("plain object into an array field", () => {
  const widget = new Widget()
  setParts(widget, { size: 0 })
  return showAll(widget)
})
attempt("number into a function field", () => {
  const widget = new Widget()
  setAction(widget, 5)
  return showAll(widget)
})
attempt("object of another class into a class field", () => {
  const widget = new Widget()
  setOwner(widget, new Square())
  return showAll(widget)
})

const frozen = Object.freeze(new Widget())
attempt("store to a frozen instance", () => { setCount(frozen, 5); return "stored" })
attempt("creation on a frozen instance", () => { setNote(frozen, "late"); return "created" })
console.log("frozen", showAll(frozen))

setNote(parsed, "parsed")
setWeight(parsed, 0.5)
for (let round = 0; round < 4; round++) {
  attempt("creation " + round, () => {
    const first = new Widget()
    const second = new Widget()
    setWeight(first, round)
    setNote(first, "n" + round)
    setNote(second, "m" + round)
    setWeight(second, round + 0.5)
    setWeight(second, round)
    return Object.keys(first).slice(-3).join() + " " + first.weight + " " + first.note + " | " + Object.keys(second).slice(-3).join() + " " + second.weight + " " + second.note
  })
}

const seen: string[] = []
Object.defineProperty(Widget.prototype, "note", { set(value: string) { seen.push("setter got " + value) }, configurable: true })
attempt("setter on the prototype", () => {
  const widget = new Widget()
  setNote(widget, "for the setter")
  return Object.keys(widget).includes("note") + " " + show(getNote(widget)) + " " + seen.join()
})
delete (Widget.prototype as any).note
attempt("setter removed again", () => {
  const widget = new Widget()
  setNote(widget, "own")
  return Object.keys(widget).includes("note") + " " + show(getNote(widget)) + " " + seen.join()
})

const base = { set note(value: string) { seen.push("base got " + value) } }
for (let round = 0; round < 3; round++) {
  attempt("literal " + round, () => {
    const plain: Options = { id: round }
    const derived: Options = { id: round }
    Object.setPrototypeOf(derived, base)
    setNote(plain, "p" + round)
    setNote(derived, "d" + round)
    return showAll(plain) + " | " + showAll(derived) + " | " + seen.length
  })
}
console.log(seen.join())

setOrder(parsed, 1)
setHint(parsed, "parsed")
setChild(parsed, null)
for (let round = 0; round < 4; round++) {
  attempt("sparse " + round, () => {
    const panel: Panel = { id: round }
    setHint(panel, "h" + round)
    setChild(panel, new Foo(round))
    setOrder(panel, round)
    const created = showAll(panel)
    setOrder(panel, round + 0.25)
    setHint(panel, "again")
    setChild(panel, new Foo(round + 10))
    return created + " | " + Object.keys(panel).join() + " " + panel.order + " " + panel.hint + " " + show(panel.child)
  })
}
console.log("parsed", showAll(parsed))
