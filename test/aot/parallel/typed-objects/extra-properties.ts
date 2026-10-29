// Untyped code adds properties that the type does not declare to typed objects: names, indices, symbols, very many of them; their key order and persistence.
interface Tagged { id: number; label: string; opt?: string }
const mark = Symbol("mark"), second = Symbol.for("second")
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
function make(id: number): Tagged { return { id, label: "l" + id } }
function keysOf(o: object): string { return Reflect.ownKeys(o).map(k => String(k)).join() }
function forIn(o: object): string { const out: string[] = []; for (const k in o) out.push(k); return out.join() }
const a = make(1)
const loose: any = a
loose[2] = "two"; loose[mark] = "m"; a.opt = "late"; loose.extra = "e"; loose.more = 1; loose[0] = "zero"; loose[second] = 2; loose["1.5"] = "not an index"; loose[-1] = "minus"
console.log(keysOf(a))
console.log(Object.keys(a).join(), forIn(a), JSON.stringify(a), Object.getOwnPropertySymbols(a).length)
console.log(a.id, a.label, a.opt, loose.extra, loose[2], loose["2"], loose[mark], loose[second], loose[-1], "extra" in a, 2 in a, mark in a, Object.hasOwn(a, "more"))
console.log(JSON.stringify({ ...a }), keysOf({ ...a }), keysOf(Object.assign({}, a)), Object.entries(a).map(e => e.join("=")).join("&"))
delete loose.extra; delete loose[0]; delete loose[mark]
loose.extra = "again"
console.log(keysOf(a), a.opt, loose.extra)
// Extras do not disturb the fields, nor the neighbours of the same layout.
a.id += 1; a.label += "!"
const b = make(2)
console.log(a.id, a.label, keysOf(b), (b as any).extra, "more" in b)
// Attributes of extras.
Object.defineProperty(a, "hiddenExtra", { value: 1, enumerable: false, configurable: true })
Object.defineProperty(a, "computedExtra", { get(this: Tagged) { return this.id * 10 }, enumerable: true, configurable: true })
Object.defineProperty(a, "fixedExtra", { value: "f", enumerable: true })
console.log(Object.keys(a).join(), loose.hiddenExtra, loose.computedExtra, attempt(() => { loose.fixedExtra = 1 }), attempt(() => delete loose.fixedExtra), JSON.stringify(a))
// Many extras on one object, then all removed.
const crowded = make(3)
for (let i = 0; i < 200; i++) (crowded as any)["x" + i] = i
let sumOfExtras = 0
for (const k in crowded) if (k[0] === "x") sumOfExtras += (crowded as any)[k]
console.log(Object.keys(crowded).length, sumOfExtras, crowded.id, crowded.label, Object.keys(crowded).slice(0, 4).join(), Object.keys(crowded)[201])
for (let i = 0; i < 200; i += 2) delete (crowded as any)["x" + i]
console.log(Object.keys(crowded).length, Object.keys(crowded).slice(0, 4).join(), Object.keys(crowded)[101])
for (const k of Object.keys(crowded)) if (k[0] === "x") delete (crowded as any)[k]
crowded.opt = "after"
console.log(JSON.stringify(crowded), keysOf(crowded))
// Extras by names that mean something: properties of Object.prototype, __proto__.
class Widget { id = 1; render(): string { return "render" + this.id } get wide(): boolean { return this.id > 1 } }
const widget = new Widget()
const looseWidget: any = widget
looseWidget.toString = () => "custom"; looseWidget.constructor = "not a function"; looseWidget.hasOwnProperty = null
console.log(String(widget), `${widget}`, Object.keys(widget).join(), widget.render(), widget.wide, widget instanceof Widget, Object.hasOwn(widget, "toString"))
// By the name of an accessor of the class, defined by typed code: the program is seen to do it.
Object.defineProperty(widget, "wide", { value: true, configurable: true })
console.log(widget.wide, new Widget().wide, Object.keys(widget).join(), Object.hasOwn(widget, "wide"))
delete looseWidget.wide
console.log(widget.wide, Object.hasOwn(widget, "wide"))
const dunder = make(4)
Object.defineProperty(dunder, "__proto__", { value: "own", enumerable: true, writable: true, configurable: true })
console.log(Object.keys(dunder).join(), (dunder as any).__proto__, Object.getPrototypeOf(dunder) === Object.prototype, JSON.stringify(dunder), dunder.label)
// Extras that hold objects stay alive while much else is allocated and dropped.
const keepers: Tagged[] = []
for (let i = 0; i < 300; i++) { const t = make(i); (t as any).payload = { deep: { n: i }, list: [i, i + 1] }; if (i % 2) (t as any)[mark] = "s" + i; if (i % 3 === 0) (t as any)[i] = t; keepers.push(t) }
let churn = 0
for (let i = 0; i < 200000; i++) { const t: Tagged = { id: i, label: "x" + (i & 7) }; (t as any).junk = [i]; churn += t.id & 1 }
let check = 0
for (const t of keepers) { const x: any = t; check += x.payload.deep.n + x.payload.list[1] + t.id + t.label.length + (x[mark] ? x[mark].length : 0) + (x[t.id] === t ? 1 : 0) }
console.log(churn, check)
// A frozen object takes no extras.
console.log(attempt(() => { (Object.freeze(make(6)) as any).extra = 1 }), attempt(() => { (Object.preventExtensions(make(7)) as any)[0] = 1 }), attempt(() => { (Object.seal(make(8)) as any)[mark] = 1 }))
