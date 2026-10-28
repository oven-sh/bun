// Spread and Object.assign onto objects with a layout: every pair of states gives the keys, order and values of plain JavaScript, also after a value that does not fit, with added properties, accessors, integrity levels and collections.
// COUNTER: StoreOfOtherType >= 1
interface T { a: number; b?: string; c?: number; d?: boolean; e?: object }
interface S { c: 1.5 | number; a?: 1 | 2; d?: boolean }
interface Wide { f0?: number; f1?: string; f2?: number; f3?: boolean; f4?: object; f5?: number; f6?: string; f7?: number; f8?: boolean; f9?: object; f10?: number; f11?: string; f12?: number; f13?: boolean; f14?: object; f15?: number; f16?: string; f17?: number; f18?: boolean; f19?: object }
interface WithMethod { a?: number; run?: () => number }

const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true))
function describeResult(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }
const show = (o: object): string => Object.keys(o).join() + " " + JSON.stringify(o)
const read = (t: T): string => [t.a, t.b, t.c, t.d, t.e === undefined ? "none" : JSON.stringify(t.e)].join("|")
const fresh = (): T => ({ a: 0 })
const filled = (): T => ({ a: 9, b: "b", c: 7, d: false, e: { kept: 1 } })
const reversed = (): T => ({ e: { kept: 2 }, d: true, c: 8, b: "r", a: 5 })

function repeated(title: string, make: (i: number) => object): void {
  let last: object = {}
  let total = 0
  for (let i = 0; i < 2000; i++) {
    last = make(i)
    total += Object.keys(last).length
  }
  console.log(title, total, show(last))
}

const sources: S[] = [{ c: 1.5, a: 1 }, { c: 2 ** 40, a: 2 }, { c: 3, a: 1, d: true }, { a: 2, c: -0.5 }]
const second: S = { a: 2, c: 1, d: false }
const plain: any = JSON.parse('{"b":"plain","c":4.25,"d":true,"e":{"x":1}}')
const plainWithNull: any = { c: null, b: undefined, a: 6 }

repeated("spread", i => { const s = sources[i % 4]; const t: T = { a: 0, ...s }; return t })
repeated("two spreads", i => { const s = sources[i % 4]; const t: T = { a: 0, ...s, ...second }; return t })
repeated("spread before field", i => { const s = sources[i % 4]; const t: T = { ...s, a: 7, b: "after" }; return t })
repeated("assign typed to fresh", i => Object.assign(fresh(), sources[i % 4]))
repeated("assign typed to filled", i => Object.assign(filled(), sources[i % 4]))
repeated("assign typed to reversed", i => Object.assign(reversed(), sources[i % 4]))
repeated("assign plain to fresh", () => Object.assign(fresh(), plain))
repeated("assign plain to filled", () => Object.assign(filled(), plain))
repeated("assign nullish", () => Object.assign(filled(), plainWithNull))
repeated("assign two to fresh", i => Object.assign(fresh(), sources[i % 4], plain))
repeated("assign two to filled", i => Object.assign(filled(), sources[i % 4], plain))
repeated("keys b then c", () => Object.assign(fresh(), { b: "1" }, { c: 2 }))
repeated("keys c then b", () => Object.assign(fresh(), { c: 2 }, { b: "1" }))

const counted = (): number => 11
repeated("method stored as field", () => { const m: WithMethod = { a: 1, run: counted }; const t: WithMethod = { a: 0, ...m }; return Object.assign(t, m) })
const method: WithMethod = { a: 1, run: counted }
const copied: WithMethod = { a: 0, ...method }
console.log(copied.run === counted, copied.run!())

const wideSource: Wide = { f19: { z: 1 }, f10: 10.5, f1: "one", f8: true, f15: 2 ** 33, f0: 0 }
repeated("twenty fields spread", () => { const w: Wide = { f3: false, ...wideSource }; return w })
repeated("twenty fields assign", () => { const w: Wide = { f3: false, f11: "x" }; return Object.assign(w, wideSource) })

// A value that does not fit, after 1,000 that did.
const loose: any = { a: 1, c: 2 }
function spreadLoose(s: S): T { const t: T = { a: 0, ...s }; return t }
function assignLoose(s: S): T { return Object.assign(fresh(), s) }
for (let i = 0; i < 1000; i++) { spreadLoose(sources[i % 4]); assignLoose(sources[i % 4]) }
const other: any = { c: 1.5, a: 1 }
other.c = "text"
const fromSpread: any = spreadLoose(other)
const fromAssign: any = assignLoose(other)
console.log(show(fromSpread), typeof fromSpread.c, show(fromAssign), typeof fromAssign.c)
console.log(show(spreadLoose(sources[0])), read(assignLoose(sources[1])), show(spreadLoose(loose)))

const grown: any = { c: 1, a: 2 }
grown.added = "more"
console.log(show(spreadLoose(grown)), show(assignLoose(grown)))

let gets = 0
const getter: any = { a: 1, get c() { gets++; return 5 } }
console.log(show(spreadLoose(getter)), gets, show(assignLoose(getter)), gets)

// Integrity levels.
function strictAssign(t: T, s: object): string {
  "use strict"
  return describeResult(() => show(Object.assign(t, s)))
}
console.log(strictAssign(Object.freeze(filled()), sources[0]), strictAssign(Object.freeze(fresh()), {}))
console.log(strictAssign(Object.seal(filled()), sources[0]), strictAssign(Object.seal(fresh()), sources[0]))
console.log(strictAssign(Object.preventExtensions(filled()), sources[0]), strictAssign(Object.preventExtensions(fresh()), sources[0]))
console.log(strictAssign(fresh(), Object.freeze({ c: 1, a: 2 })))

// The prototype of the target.
let setterCalls = 0
class WithSetter { a: number = 0; declare b?: string }
Object.defineProperty(WithSetter.prototype, "b", { set(v: string) { setterCalls++ }, get() { return "from setter" }, configurable: true })
class WithReadOnly { a: number = 0; declare b?: string }
Object.defineProperty(WithReadOnly.prototype, "b", { value: "read only", writable: false, configurable: true })
const withB: { b: string } = { b: "own" }
for (let i = 0; i < 3; i++) {
  const w = new WithSetter()
  Object.assign(w, withB)
  console.log(setterCalls, Object.keys(w).join(), w.b)
  const r = new WithReadOnly()
  console.log(describeResult(() => show(Object.assign(r, withB))), r.b)
  const spreadSetter = { ...w, ...withB }
  const spreadReadOnly = { ...r, ...withB }
  console.log(show(spreadSetter), show(spreadReadOnly), setterCalls)
}

// Assigning an object to itself, and added names.
const both = filled()
console.log(show(Object.assign(both, both)), read(both))
const spreadSelf: T = { b: "first", ...both, ...both }
console.log(show(spreadSelf))
const toStringAdded: any = Object.assign(fresh(), { toString: () => "mine" })
console.log(String(toStringAdded), Object.keys(toStringAdded).join())
const addedTwice: any = Object.assign(fresh(), { x: 1 }, { y: 2 }, { x: 3, b: "late" })
console.log(show(addedTwice), addedTwice.x, read(addedTwice))

// Key order when one source both adds a name and creates a field.
repeated("added name before created field", () => Object.assign(fresh(), { x: 1, b: "q" }))
repeated("created field before added name", () => Object.assign(fresh(), { b: "q", x: 1 }))
repeated("added name between created fields", () => Object.assign(fresh(), { c: 1, x: 1, b: "q" }))
repeated("added name before present field", () => Object.assign(filled(), { x: 1, b: "q" }))
repeated("second added name before created field", () => { const t: any = fresh(); t.x = 0; return Object.assign(t, { y: 1, b: "q" }) })

// Collections between rounds.
for (let round = 0; round < 3; round++) {
  const t: T = { a: round, ...sources[round] }
  const u = Object.assign(fresh(), sources[round], plain, { ["ex" + "tra"]: { round } })
  collect()
  console.log(show(t), show(u), read(u))
}
