// Properties named like array indexes and other canonical numeric strings, on literals, enum-keyed records and class instances.
// COUNTER: IndexedAccessor = 2
// COUNTER: DeleteOfRequiredField = 1
// COUNTER: RedefinedProperty = 0
// COUNTER: NoExtraPropertiesWord = 0
function said(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }
function show(o: object): string {
  const enumerated: string[] = []
  for (const key in o) enumerated.push(key)
  return [Object.keys(o).join(), enumerated.join(), Reflect.ownKeys(o).map(String).join(), JSON.stringify(o), JSON.stringify({ ...o }), JSON.stringify(Object.entries(o))].join(" | ")
}

interface Item { 0: string; "1": string; x: number }
const item: Item = { x: 3, "1": "b", 0: "a" }
const loose: any = item
function typedReads(r: Item): string { return [r[0], r["0"], r[1], r["1"], r.x].map(String).join() }
function untypedReads(r: any, zero: any, one: any): string { return [r[zero], r[one], r[0], r["1"], zero in r, one in r, 2 in r, "2" in r, Object.hasOwn(r, zero)].map(String).join() }
function showItem(): void { console.log(show(item), typedReads(item), untypedReads(item, 0, "1"), untypedReads(item, "0", 1)) }
showItem()
item[0] = "A"; loose["1"] = "B"; loose[2] = "C"; item.x++
showItem()
console.log(delete loose[0], delete loose["1"], 0 in item, "1" in item, show(item), typedReads(item))

enum Color { Red, Green, Blue }
const names: Record<Color, string> = { [Color.Blue]: "b", [Color.Red]: "r", [Color.Green]: "g" }
function nameOf(c: Color): string { return names[c] }
console.log(show(names), nameOf(Color.Red), nameOf(Color.Green), nameOf(Color.Blue), (names as any)["1"], Color.Green in names, delete (names as any)[Color.Red], show(names))

class Table { 1: string = "one"; x: number = 1; 0: string = "zero"; "2": string = "two"; 3() { return "three" + this[0] } get 4() { return "four" + this.x } static 5 = "five"; static 6() { return "six" + Table[5] }
  sum(): string { return this[0] + this[1] + this["2"] + this.x + this[3]() + this[4] } }
console.log(show(new Table()), new Table().sum(), Table[6](), Object.getOwnPropertyNames(Table.prototype).filter(k => k.length === 1).join(), Object.getOwnPropertyNames(Table).filter(k => k.length === 1).join())
const t: any = new Table()
for (const key of [0, "0", 1, "2", 3, "4", 7, "x"]) console.log(typeof key, key, key in t, Object.hasOwn(t, key), typeof t[key])

const converted = new Table(); (converted as any)[9] = "nine"; delete (converted as any).x
console.log(show(converted), said(() => converted.sum()))
const frozen = Object.freeze(new Table())
console.log(said(() => { (frozen as any)[0] = "changed" }), said(() => { (frozen as any)[8] = "eight" }), Object.isFrozen(frozen), show(frozen))

const watched = new Table(); let reads = 0
Object.defineProperty(watched, 0, { get() { reads++; return "got" }, enumerable: true, configurable: true })
console.log(watched[0], watched.sum(), reads, show(watched), watched.x, watched instanceof Table)
const readOnly = new Table()
Object.defineProperty(readOnly, 9, { value: "nine", writable: false, enumerable: true, configurable: true })
console.log(said(() => { (readOnly as any)[9] = "changed" }), show(readOnly))

interface Odd { "-1": number; "01": number; "1.5": number; "4294967294": number; "4294967295": number; NaN: number; Infinity: number; "-0": number; "1e+21": number; z: number }
const odd: Odd = { z: 0, "1e+21": 1, "-0": 2, Infinity: 3, NaN: 4, "4294967295": 5, "4294967294": 6, "1.5": 7, "01": 8, "-1": 9 }
const looseOdd: any = odd
console.log(show(odd))
console.log(odd["-1"], odd["01"], odd["1.5"], odd["4294967294"], odd["4294967295"], odd.NaN, odd.Infinity, odd["-0"], odd["1e+21"], odd.z)
console.log(looseOdd[-1], looseOdd[1.5], looseOdd[4294967294], looseOdd[4294967295], looseOdd[NaN], looseOdd[Infinity], looseOdd[-0], looseOdd[1e21], looseOdd["01"], looseOdd[1])
export {}
