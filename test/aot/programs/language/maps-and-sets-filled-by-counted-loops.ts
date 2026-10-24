// A Map or a Set that a loop over an array fills, as TypeScript's symbol tables are. The arrays have 0 to 300 elements; the keys are strings, whole numbers, fractions, objects, undefined and a mix;
// some repeat; some loops delete, clear or read while they fill, lengthen or shorten the array, leave early, throw, or fill a collection that already has entries, that an iterator was made over before
// it had any, that is an instance of a subclass, or whose `set` was replaced. Sizes, orders, lookups and iterators answer as in plain Bun.
interface Entry {
  name: string
  id: number
}
function entriesOf(count: number): Entry[] {
  const entries: Entry[] = []
  for (let i = 0; i < count; i++) entries.push({ name: "n" + i, id: i * 3 })
  return entries
}
function tableOf(entries: readonly Entry[]): Map<string, Entry> {
  const result = new Map<string, Entry>()
  for (const entry of entries) result.set(entry.name, entry)
  return result
}
function idsOf(entries: readonly Entry[]): Set<number> {
  const result = new Set<number>()
  for (let i = 0; i < entries.length; i++) result.add(entries[i].id)
  return result
}
function byId(entries: readonly Entry[]): Map<number, string> {
  const result = new Map<number, string>()
  for (let i = 0; i < entries.length; i++) result.set(entries[i].id + 0.5, entries[i].name)
  return result
}
function counts(entries: readonly Entry[], modulus: number): Map<string, number> {
  const result = new Map<string, number>()
  for (const entry of entries) result.set("k" + (entry.id % modulus), entry.id)
  return result
}
function backwards(entries: readonly Entry[]): Set<Entry> {
  const result = new Set<Entry>()
  for (let i = entries.length - 1; i >= 0; i--) result.add(entries[i])
  return result
}
function both(entries: readonly Entry[]): Map<string | number, Entry> {
  const result = new Map<string | number, Entry>()
  for (const entry of entries) {
    result.set(entry.name, entry)
    result.set(entry.id, entry)
  }
  return result
}
function into<K, V>(target: Map<K, V>, keys: readonly K[], value: V): Map<K, V> {
  for (const key of keys) target.set(key, value)
  return target
}
function describe(map: Map<unknown, unknown> | Set<unknown>): string {
  let text = ""
  let seen = 0
  for (const item of map) {
    const key = Array.isArray(item) ? item[0] : item
    if (seen < 3 || seen >= map.size - 2) text += (typeof key === "object" && key !== null ? (key as Entry).name : String(key)) + ","
    seen++
  }
  return map.size + ":" + seen + ":" + text
}

for (const count of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 16, 17, 25, 43, 64, 100, 255, 256, 300]) {
  const entries = entriesOf(count)
  const table = tableOf(entries)
  const ids = idsOf(entries)
  const names = byId(entries)
  let found = 0
  for (const entry of entries) {
    if (table.get(entry.name) === entry) found++
    if (ids.has(entry.id)) found++
    if (names.get(entry.id + 0.5) === entry.name) found++
    if (table.has(entry.name + "x") || ids.has(entry.id + 1) || names.has(entry.id)) found = -1000000
  }
  console.log(count, found, describe(table), describe(ids), describe(names), describe(counts(entries, 7)), describe(backwards(entries)), describe(both(entries)))
  table.set("later", entries[0])
  for (let i = 0; i < 40; i++) ids.add(-i)
  table.delete("n0")
  console.log(describe(table), describe(ids), table.has("n0"), table.has("later"))
}

const mixedKeys: unknown[] = ["a", 1, 1.5, -0, 0, NaN, NaN, undefined, null, true, "1", 2 ** 40, {}, [], Symbol.iterator, 10n, "a", 1]
console.log(describe(into(new Map<unknown, number>(), mixedKeys, 1)), describe(into(new Map<unknown, unknown>(), mixedKeys, 2.5)), describe(into(new Map<unknown, unknown>(), mixedKeys.slice().reverse(), undefined)))
console.log(describe(into(new Map<unknown, unknown>([["z", 0]]), mixedKeys, "v")), describe(into(into(new Map<unknown, unknown>(), ["p", "q"], 1), mixedKeys, 2)))

const early = new Map<string, number>()
const overNothing = early.keys()
const names = entriesOf(30).map(entry => entry.name)
for (const name of names) early.set(name, name.length)
console.log([...overNothing].length, early.size)

const changing = entriesOf(20)
const whileChanging = new Map<string, number>()
for (const entry of changing) {
  whileChanging.set(entry.name, entry.id)
  if (entry.id === 9) changing.length = 8
  if (entry.id === 6) changing.push({ name: "pushed", id: 1000 })
}
console.log(describe(whileChanging), changing.length)

const growing = entriesOf(6)
const whileGrowing = new Set<string>()
for (let i = 0; i < growing.length; i++) {
  whileGrowing.add(growing[i].name)
  if (growing.length < 90) growing.push({ name: "g" + i, id: i })
}
console.log(describe(whileGrowing))

const cleared = new Map<string, number>()
const deleted = new Set<string>()
for (const name of names) {
  cleared.set(name, 1)
  deleted.add(name)
  if (name === "n10" || name === "n20") cleared.clear()
  if (deleted.size > 3) deleted.delete("n" + (deleted.size - 4))
}
console.log(describe(cleared), describe(deleted))

function untilFound(keys: readonly string[], wanted: string): Map<string, number> {
  const result = new Map<string, number>()
  for (let i = 0; i < keys.length; i++) {
    result.set(keys[i], i)
    if (keys[i] === wanted) break
  }
  return result
}
console.log(describe(untilFound(names, "n2")), describe(untilFound(names, "n29")), describe(untilFound(names, "none")))

function throwing(keys: readonly string[], at: number): string {
  const result = new Set<string>()
  try {
    for (let i = 0; i < keys.length; i++) {
      if (i === at) throw new RangeError("stop")
      result.add(keys[i])
    }
  } catch (error) {
    return (error as Error).message + " " + describe(result)
  }
  return describe(result)
}
console.log(throwing(names, 0), throwing(names, 1), throwing(names, 17), throwing(names, 99))

class Counting<K, V> extends Map<K, V> {
  calls = 0
  set(key: K, value: V): this {
    this.calls++
    return super.set(key, value)
  }
}
const counting = into(new Counting<string, number>(), names, 5) as Counting<string, number>
console.log(counting.calls, describe(counting))
class Plain<K, V> extends Map<K, V> {}
console.log(describe(into(new Plain<string, number>(), names, 5)))
const replaced = new Map<string, number>()
let replacedCalls = 0
replaced.set = function (key: string, value: number) {
  replacedCalls++
  return key === "n3" ? this : Map.prototype.set.call(this, key, value)
}
console.log(describe(into(replaced, names, 1)), replacedCalls)

for (const count of [0, 1, 4, 5, 9, 40, 300]) {
  const entries = entriesOf(count)
  console.log(
    describe(new Set(entries.map(entry => entry.id))), describe(new Set(entries.map(entry => entry.id + 0.25))), describe(new Set(entries)), describe(new Set(entries.map(entry => entry.id % 4))),
    describe(new Map(entries.map(entry => [entry.name, entry.id] as [string, number]))), describe(new Map(entries.map(entry => [entry.id % 5, entry] as [number, Entry]))),
    describe(new Set(tableOf(entries).keys())), describe(new Map(tableOf(entries))), describe(new Set(idsOf(entries))),
  )
}

let total = 0
for (let round = 0; round < 3000; round++) {
  const entries = entriesOf(round % 23)
  total += tableOf(entries).size * 3 + idsOf(entries).size + byId(entries).size + both(entries).size
}
console.log(total)
