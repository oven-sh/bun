// `"owner" in entry`, where the layout has a slot for the name out of line and most entries were never given one: the key order alone says whether the name is there.
// What is filed about the Structure cannot say it, so the operation that files was entered at each question: 19,000 times here.
// COUNT: operation:operationAOTInByIdAndCache <= 60
// COUNT: operation:operationAOTHasOwnByIdAndCache <= 60
// COUNT: operation:operationAOTInByValAndCache <= 60
// COUNT: operation:operationAOTHasOwnByValAndCache <= 60
type Entry = { kind: string; id: string }
type Noted = Entry & { note?: string; owner?: string; place?: string; state?: string; mark?: string; level?: number }
type Stamped = Entry & { stamp: string }
function make(i: number): Entry { return { kind: "one", id: "id" + i } }
function fill(entry: Entry, i: number) {
  const noted = entry as Noted
  noted.note = i % 32 === 0 ? undefined : "n" + i
  noted.owner = "o" + i
  noted.place = i % 64 === 0 ? undefined : "p" + i
  noted.state = undefined
  noted.mark = "m"
  noted.level = i
}
function stamp(entry: Entry, i: number): Stamped { const stamped = entry as Stamped; stamped.stamp = "s" + i; return stamped }
function withoutStamp<T extends { stamp: string }>(stamped: T): Omit<T, "stamp"> { const { stamp, ...rest } = stamped; return rest }
function count(entry: Entry): number {
  let found = 0
  if ("note" in entry) found += 1
  if ("owner" in entry) found += 10
  if ("place" in entry) found += 100
  if ("state" in entry) found += 1000
  if ("mark" in entry) found += 10000
  if ("level" in entry) found += 100000
  return found
}
function countOwn(entry: Entry): number {
  let found = 0
  if (Object.hasOwn(entry, "note")) found += 1
  if (Object.hasOwn(entry, "owner")) found += 10
  if (Object.hasOwn(entry, "place")) found += 100
  if (Object.hasOwn(entry, "state")) found += 1000
  if (Object.hasOwn(entry, "mark")) found += 10000
  if (Object.hasOwn(entry, "level")) found += 100000
  return found
}
const names = ["note", "owner", "place", "state", "mark", "level"]
function countByKey(entry: Entry): number {
  let found = 0
  for (const name of names) found = found * 10 + (name in entry ? 1 : 0)
  return found
}
const entries: Entry[] = []
for (let i = 0; i < 64; i++) {
  const entry = make(i)
  if (i % 16 === 0) fill(entry, i)
  entries.push(i % 2 ? entry : (withoutStamp(stamp(entry, i)) as Entry))
}
let sum = 0
let sumOfOwn = 0
let sumByKey = 0
for (let round = 0; round < 50; round++) {
  for (let i = entries.length - 1; i >= 0; i--) {
    sum += count(entries[i]!)
    sumOfOwn += countOwn(entries[i]!)
    sumByKey += countByKey(entries[i]!)
  }
}
console.log(sum, sumOfOwn, sumByKey, count(entries[0]!), count(entries[1]!), count(entries[16]!), Object.keys(entries[0]!).join(), Object.keys(entries[1]!).join())
