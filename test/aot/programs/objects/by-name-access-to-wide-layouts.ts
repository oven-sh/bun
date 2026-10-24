// Reads, writes, `in` and `hasOwnProperty` by names computed at run time on layouts with few and many fields, past the size of the field cache.
const registered: unique symbol = Symbol.for("x")
const fresh: unique symbol = Symbol("fresh")
interface Wide { f0: number; f1: number; f2: number; f3: number; f4: number; f5: number; f6: number; f7: number; f8: number; f9: number; f10: number; f11: number; f12: number; f13: number; f14: number; f15: number; f16: number; f17: number; f18: number; f19: number; f20: number; f21: number; f22: number; f23: number; f24: number; f25: number; f26: number; f27: number; f28: number; f29: number; f30: number; f31: number; f32: number; f33: number; f34: number; f35: number; f36: number; f37: number; f38: number; f39: number; }
interface Narrow { a: number; b: number; c: number }
interface Keyed { title: string; [Symbol.iterator]: () => Iterator<number>; [registered]: number; [fresh]: number }

const createWide = (): Wide => ({ f0: 0, f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, f6: 6, f7: 7, f8: 8, f9: 9, f10: 10, f11: 11, f12: 12, f13: 13, f14: 14, f15: 15, f16: 16, f17: 17, f18: 18, f19: 19, f20: 20, f21: 21, f22: 22, f23: 23, f24: 24, f25: 25, f26: 26, f27: 27, f28: 28, f29: 29, f30: 30, f31: 31, f32: 32, f33: 33, f34: 34, f35: 35, f36: 36, f37: 37, f38: 38, f39: 39 })
const createNarrow = (): Narrow => ({ a: 1, b: 2, c: 3 })
const createKeyed = (): Keyed => ({ title: "keyed", [Symbol.iterator]: () => [1, 2][Symbol.iterator](), [registered]: 10, [fresh]: 20 })

function read(target: any, key: PropertyKey): unknown { return target[key] }
function write(target: any, key: PropertyKey, value: unknown) { target[key] = value }
function has(target: any, key: PropertyKey): boolean { return key in target }
function hasOwn(target: any, key: PropertyKey): boolean { return target.hasOwnProperty(key) }
function probe(title: string, target: any, key: PropertyKey) {
  const value = read(target, key)
  console.log(title, typeof value === "function" ? "function" : String(value), has(target, key), hasOwn(target, key))
}

const wide = createWide()
let sum = 0
for (let i = 0; i < 40; i++) {
  const name = "f" + i
  sum += read(wide, name) as number
  if (!has(wide, name) || !hasOwn(wide, name)) console.log("missing", name)
  write(wide, name, i * 2)
}
console.log("wide", sum, wide.f0, wide.f1, wide.f20, wide.f39, Object.keys(wide).length)

const narrow = createNarrow()
for (const name of ["a", "b", "c"]) {
  probe("narrow " + name, narrow, name)
  write(narrow, name, (read(narrow, name) as number) + 10)
}
console.log("narrow", narrow.a, narrow.b, narrow.c, Object.keys(narrow).join())

let found = 0
for (let i = 0; i < 5000; i++) {
  const name = "missing" + i
  for (const target of [wide, narrow]) {
    if (read(target, name) !== undefined || has(target, name) || hasOwn(target, name)) found++
  }
}
console.log("missing names found", found)
for (let i = 0; i < 40; i += 13) probe("wide again f" + i, wide, "f" + i)
probe("narrow again c", narrow, ["c"].join(""))

const rope = (left: string, right: string) => left + right
const prefix = JSON.parse('"f"') as string
probe("rope on wide", wide, rope(prefix, String(7)))
probe("rope on narrow", createNarrow(), rope(["a"].join(""), ""))
write(wide, rope(prefix, String(8)), 100)
console.log("stored by rope", wide.f8)
for (const target of [wide, narrow]) {
  probe("index name", target, "0")
  probe("__proto__", target, "__proto__")
  probe("constructor", target, "constructor")
}

const other = Symbol("other")
for (const key of [Symbol.iterator, Symbol.for("x"), fresh, other, Symbol.asyncIterator, Symbol.for("y")]) {
  for (const [title, create] of [["wide", createWide], ["narrow", createNarrow], ["keyed", createKeyed]] as [string, () => object][]) {
    const target = create()
    probe(title + " " + String(key), target, key)
    write(target, key, 5)
    probe(title + " stored " + String(key), target, key)
    console.log(Object.getOwnPropertySymbols(target).map(String).join(), Object.keys(target).length)
  }
}
console.log([...createKeyed()].join())

const additions = createWide() as any
for (let i = 40; i < 44; i++) write(additions, "f" + i, i)
write(additions, "0", "index")
console.log(Object.keys(additions).slice(0, 3).join(), Object.keys(additions).slice(-3).join(), has(additions, "f43"), hasOwn(additions, "f44"))
