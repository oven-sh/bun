// What is filed says that nothing above the object has the name. It ends when something above gets it.
class Base { common = 1 }
class Entry extends Base {
  kind = "one"
  id: string
  constructor(i: number) { super(); this.id = "id" + i }
}
type Noted = Entry & { note?: unknown; owner?: unknown; place?: unknown; state?: unknown; mark?: unknown }
function fill(entry: Entry, owner: unknown) { const noted = entry as Noted; noted.note = 1; noted.owner = owner; noted.place = undefined; noted.state = "s"; noted.mark = undefined }
function has(entry: unknown): boolean { return "owner" in (entry as object) }
function hasOwn(entry: unknown): boolean { return Object.hasOwn(entry as object, "owner") }
function hasByKey(entry: unknown, key: string): boolean { return key in (entry as object) }
const without = new Entry(0), withUndefined = new Entry(1), withText = new Entry(2), withOthers = new Entry(3)
fill(withUndefined, undefined); fill(withText, "text"); fill(withOthers, 1); delete (withOthers as Noted).owner
const all: unknown[] = [without, withUndefined, withText, withOthers, { other: 1 }, JSON.parse('{"owner":1}')]
function ask(when: string) {
  for (let round = 0; round < 3; round++) console.log(when, round, all.map(entry => `${has(entry)}|${hasOwn(entry)}|${hasByKey(entry, "owner")}|${String((entry as Noted).owner)}`).join(" "))
}
const above = Entry.prototype as any, farAbove = Base.prototype as any
ask("at first")
above.owner = "above"
ask("a value above")
delete above.owner
ask("gone again")
Object.defineProperty(above, "owner", { get() { return "got" }, configurable: true })
ask("a getter above")
delete above.owner
ask("gone once more")
above.owner = undefined
ask("undefined above")
delete above.owner
farAbove.owner = "far"
ask("far above")
delete farAbove.owner
ask("gone from there")
const between = Object.create(above, { owner: { value: 1, configurable: true } })
Object.setPrototypeOf(without, between)
ask("one object laid below another")
delete between.owner
ask("which loses the name")
Object.setPrototypeOf(above, { owner: "a new parent" })
ask("the class laid below another object")
Object.setPrototypeOf(above, farAbove)
ask("as at first")
