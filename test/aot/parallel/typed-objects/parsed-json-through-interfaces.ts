// Objects made by `JSON.parse` are used through declared types at the same sites as typed objects: reads, stores, optional fields, nesting, key order.
interface Address { city: string; zip?: string }
interface Person { id: number; nick: string; active: boolean; address: Address; tags: string[]; boss?: Person | null; score?: number }
const source = '{"nick":"ann","id":1,"active":true,"address":{"zip":"123","city":"Oslo"},"tags":["a","b"],"boss":null}'
const parsed = JSON.parse(source) as Person
const native: Person = { id: 2, nick: "bob", active: false, address: { city: "Rome" }, tags: [], boss: parsed }
function card(p: Person): string {
  return [p.id, p.nick, p.active, p.address.city, String(p.address.zip), p.tags.length, p.tags.join("+"), p.boss ? p.boss.nick : String(p.boss), String(p.score), "score" in p].join("|")
}
console.log(card(parsed))
console.log(card(native))
parsed.score = 5; parsed.id++; parsed.nick += "!"; parsed.active = !parsed.active
parsed.address = { city: "Bern" }
parsed.tags.push("c")
native.address = JSON.parse('{"city":"Kyiv","zip":"01001"}')
native.boss = JSON.parse(source)
native.tags = JSON.parse('["x","y","z"]')
console.log(card(parsed))
console.log(card(native))
console.log(JSON.stringify(parsed))
console.log(JSON.stringify(native))
delete parsed.score; delete native.boss; delete native.address.zip
parsed.boss = native
console.log(card(parsed), Object.keys(parsed).join(), Object.keys(native).join(), Object.keys(native.address).join())
parsed.score = 1.5; native.score = 2; native.address.zip = "z"
console.log(Object.keys(parsed).join(), Object.keys(native).join(), (parsed.score ?? 0) + (native.score ?? 0), native.address.zip)
// Numbers of every storage class.
interface Num { n: number; m?: number }
const nums = JSON.parse('[{"n":1},{"n":1.5},{"n":-0},{"n":1e21},{"n":2147483648,"m":-2147483648},{"n":9007199254740993},{"m":0,"n":1e-7}]') as Num[]
function totalOf(list: Num[]): number { let t = 0; for (const x of list) t += x.n + (x.m ?? 0); return t }
console.log(nums.map(x => Object.is(x.n, -0) ? "-0" : String(x.n)).join(), totalOf(nums), nums.map(x => x.n | 0).join())
nums.push({ n: 3 }, { m: 1, n: 4 })
for (const x of nums) { x.n *= 2; x.m ??= 7 }
console.log(JSON.stringify(nums), totalOf(nums))
// A reviver, a repeated key, and an own property called __proto__.
const revived = JSON.parse(source, (k, x) => k === "id" ? x + 100 : k === "zip" ? undefined : x) as Person
console.log(card(revived), Object.keys(revived.address).join())
const tricky = JSON.parse('{"__proto__":{"id":9},"id":3,"nick":"t","nick":"u","active":false,"address":{"city":"c"},"tags":[]}') as Person
console.log(card(tricky), Object.keys(tricky).sort().join(), Object.getPrototypeOf(tricky) === Object.prototype)
// In one loop with compiled objects.
const people = [JSON.parse(source) as Person, native, parsed, JSON.parse(JSON.stringify(native)) as Person]
let ids = 0
for (let i = 0; i < 100; i++) { const p = people[i % 4]; ids += p.id; if (p.boss) ids += p.boss.id; p.id += i & 1 }
console.log(ids, people.map(p => p.id).join(), JSON.stringify(JSON.parse(JSON.stringify(native)) as Person) === JSON.stringify(native))
// A compiled object holds parsed ones and the other way round, several levels deep.
interface Team { lead: Person; members: Person[] }
const team: Team = { lead: parsed, members: JSON.parse("[" + source + "," + source + "]") }
team.members.push(native)
team.members[0].address.city = "Lima"
console.log(team.members.map(m => m.address.city).join(), team.lead.boss === native)
const copy: Person = { ...team.members[1], id: 50 }
const { address, ...others } = team.members[1]
console.log(JSON.stringify(copy), address.city, JSON.stringify(others))
// Parsed JSON through a generic function, and as the values of a dictionary.
function load<T>(json: string): T { return JSON.parse(json) }
console.log(card(load<Person>(source)), card(load<Person>(JSON.stringify(native))))
const byNick: Record<string, Person> = JSON.parse('{"ann":' + source + "}")
byNick.bob = native
console.log(byNick.ann.tags.join(""), byNick.bob.address.city, Object.keys(byNick).join())
