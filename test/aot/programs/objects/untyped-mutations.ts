// Untyped code changes typed objects in every way JavaScript allows: deletes, redefinitions, integrity levels, prototypes, shadowed methods, added names. Typed reads, stores and calls before and after each change print what plain Bun prints.
// COUNTER: DeleteOfRequiredField >= 1
// COUNTER: RedefinedProperty >= 1
// COUNTER: PrototypeChange >= 1
// COUNTER: UseAsPrototype >= 1
// COUNTER: StoreOfOtherType >= 1
// COUNTER: ShadowedMethod >= 1
// COUNTER: NoExtraPropertiesWord = 0
// COUNTER: KeyOrderLimit = 0
function said(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }
type Change = (o: any) => void
interface Spot { x: number; y: number; label?: string }
class Point { x: number = 1; y: number = 2; label?: string = "p"; norm(): number { return this.x * this.x + this.y * this.y } describe(): string { return "Point " + this.x + " " + this.label } }
class Other { norm(): number { return -1 } describe(): string { return "Other " + (this as any).x } }
const makeSpot = (): Spot => ({ x: 1, y: 2, label: "p" }), makePoint = (): Spot => new Point()
const children: any[] = [], seen: unknown[] = []
function read(s: Spot): string { return s.x + " " + s.y + " " + s.label }
function store(s: Spot): string { return said(() => { s.x = 10; s.y += 1; s.label = "stored"; return read(s) }) }
function storeLabel(s: Spot): string { try { s.label = "set"; return "set " + s.label } catch (e) { return (e as Error).name + ": " + (e as Error).message } }
function around(s: Spot, change: Change): string { const before = s.x + s.y; change(s); return before + " then " + (s.x + s.y) + " " + s.label }
function inLoop(s: Spot, change: Change): string { let text = ""; for (let i = 0; i < 3; i++) { text += s.x + ";"; if (i === 1) change(s) } return text }
function call(p: Point): string { return said(() => p.norm()) + " " + said(() => p.describe()) }
function callAround(p: Point, change: Change): string { const before = p.norm(); change(p); return before + " then " + call(p) }
function shape(o: object): string {
  const descriptors: any = Object.getOwnPropertyDescriptors(o), prototype = Object.getPrototypeOf(o)
  const keys = Reflect.ownKeys(o).map(key => {
    const descriptor = descriptors[key]
    return String(key) + ":" + ("value" in descriptor ? "v" : "a") + (descriptor.writable ? "w" : "") + (descriptor.enumerable ? "e" : "") + (descriptor.configurable ? "c" : "")
  })
  const prototypeName = prototype === null ? "null" : prototype === Point.prototype ? "Point" : prototype === Other.prototype ? "Other" : prototype === Object.prototype ? "Object" : "another"
  return [keys.join(), JSON.stringify(o), Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o), prototypeName].join(" ")
}

const applyEach = (o: any, ...titles: string[]): void => { for (const title of titles) changes.find(entry => entry[0] === title)![1](o) }
const changes: [string, Change][] = [
  ["nothing", () => {}],
  ["delete required", o => { delete o.x }],
  ["delete optional", o => { delete o.label }],
  ["delete and add again", o => { delete o.x; o.x = 5 }],
  ["accessor", o => { Object.defineProperty(o, "x", { get: () => 40, set: v => { o.y = v }, enumerable: true, configurable: true }) }],
  ["read-only", o => { Object.defineProperty(o, "x", { value: 7, writable: false }) }],
  ["not enumerable", o => { Object.defineProperty(o, "y", { enumerable: false }) }],
  ["not configurable", o => { Object.defineProperty(o, "y", { configurable: false }) }],
  ["freeze", o => { Object.freeze(o) }],
  ["seal", o => { Object.seal(o) }],
  ["prevent extensions", o => { Object.preventExtensions(o) }],
  ["other prototype", o => { Object.setPrototypeOf(o, Other.prototype) }],
  ["null prototype", o => { Object.setPrototypeOf(o, null) }],
  ["__proto__ store", o => { o.__proto__ = Other.prototype }],
  ["same prototype", o => { Object.setPrototypeOf(o, Object.getPrototypeOf(o)) }],
  ["inherited label", o => { delete o.label; Object.setPrototypeOf(o, Object.create(Object.getPrototypeOf(o), { label: { value: "inherited", writable: true, enumerable: true, configurable: true } })) }],
  ["inherited setter", o => { delete o.label; Object.setPrototypeOf(o, Object.create(Object.getPrototypeOf(o), { label: { get: () => "got", set: v => { seen.push("setter " + v) }, configurable: true } })) }],
  ["prototype gains label", o => { const parent = Object.create(Object.getPrototypeOf(o)); delete o.label; Object.setPrototypeOf(o, parent); seen.push(o.label); parent.label = "late" }],
  ["use as prototype", o => { children.push(Object.create(o)) }],
  ["prototype of a function", o => { function Child() {} Child.prototype = o; children.push(new (Child as any)()) }],
  ["prototype of an object", o => { children.push(Object.setPrototypeOf({}, o)) }],
  ["other type and back", o => { o.x = "text"; seen.push(o.x); o.x = 3 }],
  ["nullish", o => { o.x = null; o.y = undefined }],
  ["shadow a method", o => { o.describe = () => "own" }],
  ["bound method", o => { o.describe = Point.prototype.describe.bind(o) }],
  ["bound with an argument", o => { o.norm = (Point.prototype.norm as any).bind(o, 1) }],
  ["wrapped method", o => { o.norm = function (this: any) { return Point.prototype.norm.call(this) + 1000 } }],
  ["method by definition", o => { Object.defineProperty(o, "norm", { value: () => 0 }) }],
  ["add names", o => { o.extra = 1; o[3] = "three"; o["two words"] = 4 }],
  ["add and delete a name", o => { o.extra = 1; delete o.extra }],
  ["add, delete, add", o => { o.extra = 1; delete o.extra; o.again = 2 }],
  ["accessor on an added name", o => { Object.defineProperty(o, "virtual", { get() { return this.x }, set(v) { this.y = v }, enumerable: true, configurable: true }); o.virtual = 30 }],
  ["assign", o => { Object.assign(o, { y: 20, more: true }) }],
  ["reflect", o => { Reflect.set(o, "x", 8); Reflect.defineProperty(o, "z", { value: 1, writable: true, enumerable: true, configurable: true }); Reflect.deleteProperty(o, "label") }],
  ["capture stack", o => { Error.captureStackTrace(o) }],
  ["add names, freeze, use as prototype", o => { applyEach(o, "add names", "freeze", "use as prototype") }],
  ["add names, seal, use as prototype", o => { applyEach(o, "add names", "seal", "use as prototype") }],
  ["prevent extensions, delete required", o => { applyEach(o, "prevent extensions", "delete required") }],
  ["delete required, freeze", o => { applyEach(o, "delete required", "freeze") }],
  ["delete optional, freeze", o => { applyEach(o, "delete optional", "freeze") }],
  ["inherited setter, freeze", o => { applyEach(o, "inherited setter", "freeze") }],
]

for (const [title, change] of changes) {
  for (const make of [makeSpot, makePoint]) {
    const isPoint = make === makePoint, c = make()
    const parts = [title, isPoint ? "Point" : "Spot", around(make(), change), inLoop(make(), change), said(() => change(c)), read(c), storeLabel(c), store(c), shape(c)]
    if (isPoint) parts.push(call(c as Point), callAround(make() as Point, change))
    console.log(parts.join(" | "))
  }
}
console.log(seen.map(String).join())
console.log(children.map(child => read(child)).join())

const parent = new Point(), child: any = Object.create(parent)
console.log(child.x, child.norm(), Object.keys(child).length, "x" in child, Object.hasOwn(child, "x"))
parent.x = 9
console.log(child.x, read(child), call(child))
child.x = 1
console.log(parent.x, child.x, read(parent))

const stray = new Point(); (stray as any).x = "text"
console.log((stray as any).x, stray.y, stray.label, JSON.stringify(stray), Object.keys(stray).join())
const keyed: any = new Point(); keyed[Symbol.for("s")] = 2; keyed["key " + keyed.x] = 4
console.log(shape(keyed), read(keyed), keyed[Symbol.for("s")])

class Failure { stack: string = ""; code: number = 1; constructor() { Error.captureStackTrace(this, Failure) } }
const failure = new Failure()
console.log(typeof failure.stack, failure.code, Object.keys(failure).join(), Object.prototype.propertyIsEnumerable.call(failure, "stack"))

interface Loose { id: number; [key: string]: unknown }
const loose: Loose = { id: 1 }, log: unknown[] = []
Object.defineProperty(loose, "total", { set(v) { log.push(v) }, get() { return log.length }, enumerable: true, configurable: true })
loose.total = 5; loose.other = 6
console.log(log.join(), loose.total, loose.other, loose.id, Object.keys(loose).join())
class Handler { n: number = 1; constructor() { this.run = this.run.bind(this) } run(): number { return this.n } }
const handler = new Handler(), detached = handler.run
console.log(detached(), detached.call({ n: 5 }), Object.keys(handler).join(), handler.run !== Handler.prototype.run)

class Named { declare name: string; constructor(peek?: (o: Named) => void) { if (peek) { (this as any).tag = 1; peek(this) } this.name = "x" } }
const whole = new Named(); (whole as any).tag = 1
console.log(JSON.stringify({ ...whole }))
new Named(o => console.log(JSON.stringify({ ...o }), Object.keys(o).join()))

const bare = new Point(); delete bare.label; (Point.prototype as any).label = "from the class"
console.log(bare.label, read(bare), new Point().label, Object.hasOwn(bare, "label"))
delete (Point.prototype as any).label
console.log(bare.label)

let total = 0
for (let i = 0; i < 300; i++) {
  const s = i & 1 ? makePoint() : makeSpot()
  if (i % 3 === 0) said(() => changes[i % changes.length][1](s))
  total += (Number(s.x) + Number(s.y)) || 0
}
console.log(total)
export {}
