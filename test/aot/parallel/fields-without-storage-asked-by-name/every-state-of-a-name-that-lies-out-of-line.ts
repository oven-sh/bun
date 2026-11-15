// One name, one layout, and every state that an object can have the name in. Each is asked four times over, so that the last questions find what the first ones filed.
type Entry = { kind: string; id: string }
type Noted = Entry & { note?: unknown; owner?: unknown; place?: unknown; state?: unknown; mark?: unknown }
function make(i: number): Entry { return { kind: "one", id: "id" + i } }
function give(entry: Entry, value: unknown) { (entry as Noted).owner = value }
function giveOthers(entry: Entry) {
  const noted = entry as Noted
  noted.note = 1; noted.place = undefined; noted.state = "s"; noted.mark = undefined
}
function take(entry: Entry) { delete (entry as Noted).owner }
function has(entry: Entry): boolean { return "owner" in entry }
function hasOwn(entry: Entry): boolean { return Object.hasOwn(entry, "owner") }
function read(entry: Entry): unknown { return (entry as Noted).owner }
const states: [string, (entry: Entry) => Entry][] = [
  ["never given", entry => entry],
  ["given undefined", entry => { give(entry, undefined); return entry }],
  ["given a text", entry => { give(entry, "text"); return entry }],
  ["given null", entry => { give(entry, null); return entry }],
  ["given and taken", entry => { give(entry, "text"); take(entry); return entry }],
  ["given undefined and taken", entry => { give(entry, undefined); take(entry); return entry }],
  ["taken though never given", entry => { take(entry); return entry }],
  ["given, taken, given undefined", entry => { give(entry, 1); take(entry); give(entry, undefined); return entry }],
  ["given undefined, then a text, then undefined", entry => { give(entry, undefined); give(entry, "t"); give(entry, undefined); return entry }],
  ["others given, this one not", entry => { giveOthers(entry); return entry }],
  ["others given, then undefined", entry => { giveOthers(entry); give(entry, undefined); return entry }],
  ["undefined, then others", entry => { give(entry, undefined); giveOthers(entry); return entry }],
  ["defined hidden", entry => Object.defineProperty(entry, "owner", { value: undefined, enumerable: false, configurable: true, writable: true })],
  ["defined with a getter", entry => Object.defineProperty(entry, "owner", { get() { return undefined }, enumerable: true, configurable: true })],
  ["given undefined, defined read-only", entry => { give(entry, undefined); return Object.defineProperty(entry, "owner", { writable: false }) }],
  ["frozen without", entry => Object.freeze(entry)],
  ["frozen with undefined", entry => { give(entry, undefined); return Object.freeze(entry) }],
  ["sealed with undefined", entry => { give(entry, undefined); return Object.seal(entry) }],
  ["not extensible without", entry => Object.preventExtensions(entry)],
  ["a name beside the fields", entry => { (entry as any)["beside" + entry.id] = 1; return entry }],
  ["a name beside the fields and undefined", entry => { (entry as any)["beside" + entry.id] = 1; give(entry, undefined); return entry }],
  ["a copy by spread without", entry => ({ ...entry })],
  ["a copy by spread with undefined", entry => { give(entry, undefined); return { ...entry } }],
  ["a rest without", entry => { const { kind, ...rest } = entry; return rest as Entry }],
  ["a rest with undefined", entry => { give(entry, undefined); const { kind, ...rest } = entry; return rest as Entry }],
  ["a rest that leaves it out", entry => { give(entry, undefined); const { owner, ...rest } = entry as Noted; return rest as Entry }],
  ["assigned from one with undefined", entry => { const from = make(99); give(from, undefined); return Object.assign(entry, from) }],
  ["below one that has it", entry => { const above = make(98); give(above, undefined); return Object.setPrototypeOf(entry, above) }],
  ["below one that lacks it", entry => Object.setPrototypeOf(entry, make(97))],
  ["below null", entry => Object.setPrototypeOf(entry, null)],
  ["below null with undefined", entry => { give(entry, undefined); return Object.setPrototypeOf(entry, null) }],
]
const made = states.map(([name, prepare], i) => [name, prepare(make(i))] as const)
for (let round = 0; round < 4; round++) {
  const line: string[] = []
  for (const [, entry] of made) line.push((has(entry) ? "i" : "-") + (hasOwn(entry) ? "o" : "-") + (Reflect.has(entry, "owner") ? "r" : "-") + (read(entry) === undefined ? "u" : "v"))
  console.log(round, line.join(" "))
}
for (const [name, entry] of made) console.log(name + ":", has(entry), hasOwn(entry), Object.keys(entry).join(), JSON.stringify(entry))
