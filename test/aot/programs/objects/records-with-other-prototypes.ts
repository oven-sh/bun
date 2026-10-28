// Objects of one layout take other prototypes and added properties, by hand and through new.target, while collections kill the Structures nothing uses. Every read prints what plain Bun prints.
// COUNTER: PrototypeChange = 4
// COUNTER: UseAsPrototype >= 1
const collect: (full: boolean) => void = (globalThis as any).Bun ? full => (globalThis as any).Bun.gc(full) : full => (full ? (globalThis as any).fullGC() : (globalThis as any).edenGC());
function describeResult(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }

interface Entry { id: number; label: string; note?: string }
interface Kind { kind: string; note: string; describe(this: any): string }

const first: Kind = { kind: "first", note: "inherited", describe() { return "first " + this.id } }
const second: any = Object.create(null)
second.kind = "second"
second.describe = function (this: any) { return "second " + this.label }
const third: any = Object.create(first)
third.kind = "third"
const prototypes: any[] = [first, second, third]

function createEntries(count: number): Entry[] {
  const entries: Entry[] = []
  for (let i = 0; i < count; i++) {
    const entry: Entry = { id: i, label: "e" + i }
    Object.setPrototypeOf(entry as any, prototypes[i % 3])
    entries.push(entry)
  }
  return entries
}

function summarize(entries: Entry[]): string {
  let ids = 0, labels = 0, notes = 0, kinds = 0, matches = 0
  entries.forEach((entry, i) => {
    ids += entry.id
    labels += entry.label.length
    notes += entry.note === undefined ? 0 : entry.note.length
    kinds += (entry as any).kind.length
    if (Object.getPrototypeOf(entry) === prototypes[i % 3]) matches++
  })
  return [ids, labels, notes, kinds, matches].join(" ")
}

const entries = createEntries(1000)
console.log("other prototypes", summarize(entries))
console.log((entries[0] as any).describe(), (entries[1] as any).describe(), (entries[2] as any).describe())

const addedNames = [["a"], ["a", "b"], ["b", "a"], ["a", "b", "c", "d", "e"], ["e", "d", "c", "b", "a"]]
function addProperties(list: Entry[], round: number): string {
  let added = 0
  list.forEach((entry, i) => {
    addedNames[i % 5].forEach((name, k) => { (entry as any)[name] = round * 10 + k })
  })
  list.forEach(entry => { added += (entry as any).a })
  return added + " " + Object.keys(list[3]).join() + " " + Object.keys(list[4]).join()
}

const retained: Entry[][] = []
for (let round = 0; round < 6; round++) {
  const batch = createEntries(150)
  console.log("round", round, addProperties(batch, round), summarize(batch))
  if (round % 2 === 0) retained.push(batch)
  collect(round % 3 === 2)
  for (const earlier of retained) console.log(" retained", summarize(earlier), (earlier[9] as any).e, Object.keys(earlier[8]).join())
}
entries.slice(0, 15).forEach((entry, i) => { (entry as any)[addedNames[i % 5][0]] = i })
console.log("added late", summarize(entries), Object.keys(entries[14]).join())

class Point {
  x: number = 1
  y: number = 2
  sum(): number { return this.x + this.y }
}
class Shifted extends Point { shift(): string { return "shifted " + this.x } }
class Other { sum(): number { return -1 } }
function PlainTarget() {}
PlainTarget.prototype.tag = "plain"
function NoPrototype() {}
(NoPrototype as any).prototype = 7

function constructWith(newTarget: Function): string {
  const instance: any = Reflect.construct(Point, [], newTarget)
  return [instance.x, instance.y, typeof instance.sum, instance.tag, instance instanceof Point, Object.getPrototypeOf(instance) === newTarget.prototype, Object.getPrototypeOf(instance) === Object.prototype, Object.keys(instance).join()].join(" ")
}
for (let round = 0; round < 3; round++) {
  console.log("construct", constructWith(Shifted))
  console.log("construct", constructWith(PlainTarget))
  console.log("construct", constructWith(NoPrototype))
  collect(round === 1)
}

let matches = 0
for (let i = 0; i < 100; i++) {
  const Each = class { n: number = i; which(): number { return this.n } }
  const instance = new Each()
  if (instance.constructor === Each && instance.which() === i && Object.getPrototypeOf(instance) === Each.prototype) matches++
}
console.log("class evaluations", matches)

function readPoint(point: Point): string { return point.x + " " + point.y + " " + describeResult(() => point.sum()) }
const unchanged = new Point()
Object.setPrototypeOf(unchanged as any, Point.prototype)
console.log("same prototype", readPoint(unchanged))
const changes: any[] = [Other.prototype, first, null, Shifted.prototype]
for (const prototype of changes) {
  const point = new Point()
  Object.setPrototypeOf(point as any, prototype)
  console.log("changed", readPoint(point), (point as any).kind, Object.getPrototypeOf(point) === prototype, Object.keys(point).join())
}

const withoutPrototype: Entry = { id: 7, label: "n" }
Object.setPrototypeOf(withoutPrototype as any, null)
console.log("null", withoutPrototype.id, withoutPrototype.label, withoutPrototype.note, Object.getPrototypeOf(withoutPrototype), (withoutPrototype as any).kind)
;(withoutPrototype as any).added = 1
collect(true)
console.log("null added", withoutPrototype.id, (withoutPrototype as any).added, Object.keys(withoutPrototype).join())
