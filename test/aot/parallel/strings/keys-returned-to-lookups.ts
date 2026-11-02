// Functions that make a key and return it, as TypeScript's getRelationKey does; their callers look it up in a Map, a Set and an object, keep it in arrays, compare it and read its characters.
// The keys are short and long, of one byte and of two bytes a character, look like array indexes, are empty, and are made of numbers, strings, booleans, undefined and null.
interface Item {
  id: number
  name: string
}
function relationKey(source: Item, target: Item, postfix: string): string {
  return `${source.id},${target.id}${postfix}`
}
function nameKey(source: Item, target: Item): string {
  return source.name + "|" + target.name
}
function indexKey(first: number, second: number): string {
  return "" + first + second
}
function listKey(items: readonly Item[]): string {
  let result = ""
  for (const item of items) {
    if (result.length) result += ","
    result += item.id
  }
  return result
}
function chosenKey(source: Item, target: Item, byName: boolean): string {
  return byName ? nameKey(source, target) : relationKey(source, target, "")
}
function mixedKey(a: unknown, b: unknown): string {
  return a + ":" + b
}

const items: Item[] = []
const names = ["a", "", "long".repeat(40), "é", "日本語", "😀", "0", "-1", "x y", "__proto__", "constructor", "\u0000", "a|b"]
for (let i = 0; i < 200; i++) items.push({ id: i * 37 - 500, name: names[i % names.length] + (i > 100 ? i : "") })

const relation = new Map<string, number>()
const seen = new Set<string>()
const table: Record<string, number> = {}
const kept: string[] = []
let found = 0
for (let round = 0; round < 30; round++) {
  for (let i = 0; i < items.length; i++) {
    const source = items[i]
    const target = items[(i * 13 + round) % items.length]
    const id = relationKey(source, target, round % 3 ? "" : ":" + (round % 5))
    const entry = relation.get(id)
    if (entry !== undefined) found += entry
    else relation.set(id, i)
    if (!seen.has(id)) {
      seen.add(id)
      if (id.startsWith("-") && kept.length < 50) kept.push(id)
    }
    const named = nameKey(source, target)
    table[named] = (table[named] ?? 0) + 1
    const chosen = chosenKey(source, target, round % 2 === 0)
    if (relation.has(chosen)) found++
  }
}
console.log(relation.size, seen.size, found, Object.keys(table).length, kept.length, kept.slice(0, 5).join(" "), kept[7].length, kept[9].charCodeAt(1), kept[3] === relationKey(items[0], items[3], ""))

let total = 0
for (const key of Object.keys(table).sort()) total = (total * 31 + key.length * table[key]) | 0
console.log(total, table["a|"], table["|a"], table[nameKey(items[3], items[4])], table[nameKey(items[9], items[10])], Object.getPrototypeOf(table) === Object.prototype)

const byIndex: number[] = []
const sparse: Record<string, string> = {}
for (let first = 0; first < 12; first++) {
  for (let second = 0; second < 12; second++) {
    const key = indexKey(first, second)
    sparse[key] = key
    byIndex[key as unknown as number] = first + second
  }
}
console.log(byIndex.length, Object.keys(sparse).slice(0, 14).join(), sparse["00"], sparse["0"], sparse[indexKey(1, 0)], byIndex[10], byIndex[indexKey(11, 11) as unknown as number], Object.keys(byIndex).length)

const lists = new Map<string, number>()
for (let length = 0; length < 40; length++) lists.set(listKey(items.slice(0, length)), length)
console.log(lists.size, lists.get(""), lists.get("-500"), lists.get(listKey(items.slice(0, 3))), lists.get(listKey(items.slice(0, 39))), listKey(items.slice(0, 39)).length)

const mixed = new Map<string, string>()
const parts: unknown[] = [0, -0, 1.5, NaN, Infinity, 1e21, 1e-7, 4294967295, 4294967296, true, false, undefined, null, "", "s", 12n, "é", "日"]
for (const a of parts) for (const b of parts) mixed.set(mixedKey(a, b), String(a) + "&" + String(b))
console.log(mixed.size, mixed.get("0:0"), mixed.get("NaN:undefined"), mixed.get(":"), mixed.get("12:é"), mixed.get(mixedKey(1e21, -0)), mixed.get(mixedKey("日", null)), [...mixed.keys()].join("").length)
