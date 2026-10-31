// An interface that extends an array type describes arrays that have some more properties, as TypeScript's NodeArray<T> does. Loops, indexes, lengths, patterns, spreads and methods
// treat such a value as the array it is, and the properties beside the elements are read and stored by name. A value that only looks like one (an object written by hand, a subclass
// with an iterator of its own, an array whose own Symbol.iterator was replaced) goes through the same functions and answers as in plain Bun.
interface Range {
  pos: number
  end: number
}
interface Item {
  kind: number
  text: string
}
interface ItemList<T extends Item> extends ReadonlyArray<T>, Range {
  readonly hasTrailingComma: boolean
  flags: number
}
interface MutableItemList<T extends Item> extends Array<T>, Range {
  hasTrailingComma: boolean
  flags: number
}
interface NamedItemList extends ItemList<Item> {
  name: string
}
interface Holder {
  kind: number
  items: ItemList<Item>
  more: ItemList<Item> | undefined
}

function createList<T extends Item>(elements: readonly T[], hasTrailingComma?: boolean): ItemList<T> {
  const list = elements.slice() as MutableItemList<T>
  list.pos = -1
  list.end = -1
  list.hasTrailingComma = !!hasTrailingComma
  list.flags = 0
  for (const element of list) list.flags |= element.kind
  return list
}
function item(kind: number): Item {
  return { kind, text: "i" + kind }
}
function sumByLoop(list: ItemList<Item>): number {
  let sum = 0
  for (const element of list) sum += element.kind
  return sum
}
function sumByIndex(list: ItemList<Item>): number {
  let sum = 0
  for (let i = 0; i < list.length; i++) sum += list[i].kind
  return sum
}
function firstTwo(list: ItemList<Item>): string {
  const [first, second] = list
  return (first ? first.text : "-") + (second ? second.text : "-")
}
function spreadOf(list: ItemList<Item>): Item[] {
  return [...list, item(100)]
}
function texts(list: ItemList<Item>): string {
  return list.map(element => element.text).join()
}
function asPlainArray(list: readonly Item[]): number {
  let sum = 0
  for (const element of list) sum += element.kind * 2
  return sum
}
function rangeOf(list: Range): string {
  return list.pos + ".." + list.end
}
function describe(list: ItemList<Item>): string {
  return [
    sumByLoop(list), sumByIndex(list), firstTwo(list), spreadOf(list).length, texts(list), asPlainArray(list), rangeOf(list), list.hasTrailingComma, list.flags, list.length,
    Array.isArray(list), Object.keys(list).join(), JSON.stringify(list), "pos" in list, list.some(element => element.kind === 2), list.indexOf(list[0]),
  ].join(" | ")
}
function attempt(action: () => string): string {
  try {
    return action()
  } catch (error) {
    return (error as Error).constructor.name
  }
}

const lists: ItemList<Item>[] = []
for (let length = 0; length < 7; length++) {
  const elements: Item[] = []
  for (let i = 0; i < length; i++) elements.push(item(i + 1))
  lists.push(createList(elements, length % 2 === 1))
}
for (const list of lists) console.log(describe(list))

const holders: Holder[] = []
for (let i = 0; i < 5000; i++) holders.push({ kind: i, items: lists[i % lists.length], more: i % 3 ? undefined : createList([item(i)]) })
let total = 0
for (const holder of holders) {
  total += sumByLoop(holder.items)
  if (holder.more) for (const element of holder.more) total += element.kind
}
console.log(total)

const named = createList([item(7), item(8)]) as unknown as NamedItemList & { name: string }
named.name = "named"
console.log(describe(named), named.name)

const mutable = createList([item(1)]) as unknown as MutableItemList<Item>
mutable.push(item(2), item(3))
mutable.pos = 5
mutable.end = 9
mutable.length = 2
console.log(describe(mutable))
let seen = ""
for (const element of mutable) {
  seen += element.text
  if (mutable.length < 5) mutable.push(item(mutable.length + 10))
}
console.log(seen, mutable.length)

const byHand = {
  0: item(1), 1: item(2), length: 2, pos: 3, end: 4, hasTrailingComma: false, flags: 3,
  *[Symbol.iterator]() { yield item(40); yield item(41) },
  map(callback: (element: Item) => string) { return [callback(item(50))] },
  some() { return false },
  indexOf() { return -7 },
} as unknown as ItemList<Item>
console.log(attempt(() => describe(byHand)))

class Reversed<T> extends Array<T> {
  *[Symbol.iterator](): ArrayIterator<T> {
    for (let i = this.length - 1; i >= 0; i--) yield this[i]
  }
}
const reversed = Reversed.from([item(1), item(2), item(3)]) as unknown as MutableItemList<Item>
reversed.pos = 0
reversed.end = 1
reversed.hasTrailingComma = true
reversed.flags = 0
console.log(attempt(() => describe(reversed)))

const replaced = createList([item(1), item(2)]) as unknown as MutableItemList<Item>
Object.defineProperty(replaced, Symbol.iterator, { value: function* () { yield item(60) }, configurable: true })
console.log(attempt(() => describe(replaced)))

const sparse = createList([item(1), item(2), item(3)]) as unknown as MutableItemList<Item>
delete (sparse as unknown as Record<number, Item>)[1]
console.log(attempt(() => describe(sparse)))
console.log(attempt(() => describe(undefined as unknown as ItemList<Item>)))
console.log(attempt(() => describe("text" as unknown as ItemList<Item>)))
console.log(attempt(() => describe(Object.freeze(createList([item(9)])))))
