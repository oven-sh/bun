// A constructor function stores undefined into most of its fields, as TypeScript's Symbol does. Few objects ever get a value there, so the fields need no room until then.
// The stores that come later find the fields listed: they store numbers, booleans, objects and undefined again, in typed code, while the collector runs. Every way to look at the objects answers as in plain Bun.
interface Entry {
  flags: number
  name: string
  declarations: Entry[] | undefined
  parent: Entry | undefined
  members: Map<string, Entry> | undefined
  exportEntry: Entry | undefined
  constOnly: boolean | undefined
  isReferenced: number | undefined
  lastPosition: number | undefined
  links: unknown
}
function Entry(this: Entry, flags: number, name: string) {
  this.flags = flags
  this.name = name
  this.declarations = undefined
  this.parent = undefined
  this.members = undefined
  this.exportEntry = undefined
  this.constOnly = undefined
  this.isReferenced = undefined
  this.lastPosition = undefined
  this.links = undefined
}
const EntryConstructor = Entry as unknown as new (flags: number, name: string) => Entry

function setLastPosition(entry: Entry, position: number | undefined) {
  entry.lastPosition = position
}
function setConstOnly(entry: Entry, value: boolean | undefined) {
  entry.constOnly = value
}
function setExportEntry(entry: Entry, value: Entry | undefined) {
  entry.exportEntry = value
}
function setMembers(entry: Entry, value: Map<string, Entry> | undefined) {
  entry.members = value
}
function setReferenced(entry: Entry, value: number | undefined) {
  entry.isReferenced = value
}
function show(value: unknown): string {
  if (value === undefined) return "u"
  if (value instanceof Map) return "map" + value.size
  if (Array.isArray(value)) return "[" + value.length + "]"
  if (typeof value === "object" && value !== null) return "#" + (value as Entry).name
  return String(value)
}
function describe(entry: Entry): string {
  const inLoop: string[] = []
  for (const key in entry) inLoop.push(key)
  return [
    show(entry.declarations), show(entry.parent), show(entry.members), show(entry.exportEntry), show(entry.constOnly), show(entry.isReferenced), show(entry.lastPosition), show(entry.links),
    Object.keys(entry).join(),
    inLoop.length,
    "lastPosition" in entry, Object.hasOwn(entry, "constOnly"), Object.hasOwn(entry, "missing"),
    Object.entries({ ...entry }).map(([key, value]) => key + "=" + show(value)).join(),
    JSON.stringify(entry, (key, value) => (key !== "" && typeof value === "object" && value !== null ? show(value) : value)),
  ].join(" | ")
}
function hash(text: string): number {
  let result = 0
  for (let i = 0; i < text.length; i++) result = (result * 31 + text.charCodeAt(i)) | 0
  return result
}

const entries: Entry[] = []
for (let i = 0; i < 20000; i++) entries.push(new EntryConstructor(i, "e" + i))
console.log(describe(entries[0]))

let garbage: unknown[] = []
for (let round = 0; round < 4; round++) {
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    if (i % 7 === round) setLastPosition(entry, round % 2 ? i + 0.5 : i)
    if (i % 11 === round) setConstOnly(entry, i % 2 === 0)
    if (i % 13 === round) setExportEntry(entry, entries[(i * 17) % entries.length])
    if (i % 17 === round) setMembers(entry, new Map([["self", entry]]))
    if (i % 19 === round) setReferenced(entry, i)
    if (i % 23 === round) {
      setLastPosition(entry, undefined)
      setConstOnly(entry, undefined)
      setExportEntry(entry, undefined)
    }
    if (i % 64 === 0) garbage.push({ i, text: "g" + i, list: [i, i + 1] })
  }
  if (garbage.length > 500) garbage = []
  let sum = 0
  for (const entry of entries) sum = (sum * 33 + hash(describe(entry))) | 0
  console.log(round, sum)
}
for (const index of [0, 1, 2, 3, 7, 11, 13, 17, 19, 23, 46, 91, 143, 19999]) console.log(index, describe(entries[index]))

const late = new EntryConstructor(1, "late")
delete (late as Partial<Entry>).lastPosition
console.log(describe(late))
setLastPosition(late, 5)
console.log(describe(late))
const frozen = Object.freeze(new EntryConstructor(2, "frozen"))
try {
  setLastPosition(frozen, 6)
  console.log("stored")
} catch (error) {
  console.log((error as Error).constructor.name)
}
console.log(describe(frozen))
const sealed = Object.seal(new EntryConstructor(3, "sealed"))
setLastPosition(sealed, 7)
setConstOnly(sealed, true)
console.log(describe(sealed))
