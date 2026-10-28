// Number fields where compiled code stores only small integers, so that a 4-byte slot is predicted, receive every kind of number, null and undefined from other code. Reads, arithmetic, copies, a freeze, the conversion to an ordinary object and a collection see the exact values.
// COUNTER: StoreOfOtherType = 0
// COUNTER: RedefinedProperty = 0
// COUNTER: DeleteOfRequiredField = 1
function said(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }
const collect: () => void = (globalThis as any).gc ?? (() => (globalThis as any).Bun.gc(true))
const say = (v: unknown): string => (Object.is(v, -0) ? "-0" : String(v))
const odd: number[] = (JSON.parse('[0,1,-1,1073741823,1073741824,-1073741824,-1073741825,2147483646,2147483647,2147483648,-2147483642,-2147483643,-2147483644,-2147483645,-2147483646,-2147483647,-2147483648,-2147483649,4294967295,4294967296,9007199254740991,0.5,-0.5,1e300,5e-324,"-0","NaN","Infinity","-Infinity"]') as unknown[]).map(Number)

class ByText { price: number = 0; volume: number = 1; label: string = "t"; view(): string { return say(this.price) + " " + say(this.price + 1) + " " + (this.price | 0) + " " + this.volume } }
class ByKey { price: number = 0; volume: number = 1; label: string = "k"; view(): string { return say(this.price) + " " + say(this.price + 1) + " " + (this.price | 0) + " " + this.volume } }
class ByName { price: number = 0; volume: number = 1; label: string = "n"; view(): string { return say(this.price) + " " + say(this.price + 1) + " " + (this.price | 0) + " " + this.volume } }
class Typed { price: number = 0; volume: number = 1; label: string = "y"; seen?: number; view(): string { return say(this.price) + " " + say(this.price + 1) + " " + (this.price | 0) + " " + this.volume } }
const putByText = new Function("o", "k", "v", "o[k] = v") as (o: unknown, k: string, v: unknown) => void
const field = ["pri", "ce"].join("")
const byText = new ByText(), byKey = new ByKey(), byName = new ByName(), typed = new Typed()
const routes: [string, () => string, () => number, (v: any) => void][] = [
  ["by text", () => byText.view(), () => byText.price, v => putByText(byText, "price", v)],
  ["by key", () => byKey.view(), () => byKey.price, v => { (byKey as any)[field] = v }],
  ["by name", () => byName.view(), () => byName.price, v => { (byName as any).price = v }],
  ["typed", () => typed.view(), () => typed.price, (v: number) => { typed.price = v }],
]
for (const [title, view, price, put] of routes) {
  const texts: string[] = []
  for (const v of [...odd, null, undefined]) {
    put(v)
    texts.push(view() + " " + say(price()))
    put(7)
    if (price() !== 7) texts.push("not back")
  }
  console.log(title, texts.join(" | "))
}

const marks: number[] = JSON.parse("[5,5.5,-2147483647,-2147483646,-2147483645,-2147483644,-2147483648]")
const t = new Typed()
console.log("seen" in t)
for (const v of marks) { t.seen = v; console.log("seen" in t, say(t.seen), Object.keys(t).join()) }
delete t.seen
console.log("seen" in t, t.seen)
t.seen = 1
console.log(Object.keys(t).join())

const source = new ByText()
putByText(source, "price", odd[19] + odd[21]); putByText(source, "volume", odd[16])
const spread = { ...source }, assigned = Object.assign(new ByText(), source)
console.log(JSON.stringify(spread), JSON.stringify(assigned), JSON.stringify(source), Object.values(source).map(say).join(), Object.entries(source).join())
assigned.price = 1
console.log(source.view())
putByText(source, "price", odd[21])
console.log(assigned.view(), say(spread.price))
;[source.price, source.volume] = [source.volume, source.price]
console.log(source.view())
for (const v of [odd[26], odd[25], odd[23], odd[9], odd[16]]) { putByText(source, "price", v); console.log(JSON.stringify(source)) }

const frozen = new ByText(), converted = new ByText()
putByText(frozen, "price", odd[19] + odd[21]); putByText(converted, "price", odd[19] + odd[21])
Object.freeze(frozen)
console.log(frozen.view(), said(() => { frozen.price = 1 }))
delete (converted as any).label
console.log(converted.view(), Object.keys(converted).join())

class Counter { total: number = 0; step: number = 1; up(): number { return (this.total += this.step) } down(): number { return (this.total -= this.step) } }
function repeat(times: number, move: () => number): string { const results: number[] = []; for (let i = 0; i < times; i++) results.push(move()); return results.join() }
const counter = new Counter()
counter.total = 2147483645
console.log(repeat(4, () => counter.up()), repeat(4, () => counter.down()))
counter.total = -2147483640
console.log(repeat(12, () => counter.down()), repeat(12, () => counter.up()))
counter.total = 0; counter.step = 2147483647
console.log(repeat(3, () => counter.up()))

const many: ByText[] = []
for (let i = 0; i < 20000; i++) { const o = new ByText(); putByText(o, "price", i * 300000.5); putByText(o, "volume", i * 300000); many.push(o) }
collect()
let sum = 0
for (const o of many) sum += o.price + o.volume
console.log(sum)
export {}
