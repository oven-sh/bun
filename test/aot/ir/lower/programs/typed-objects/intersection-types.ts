// RUN: lower
// OPTIONS: builtin-modules

// Intersection types: an object created as `A & B` is read and written as `A`, as `B` and as the intersection.
type HasId = { id: number }
type HasLabel = { label: string; note?: string }
type Stamps = { created: number; updated?: number }
type Entity = HasId & HasLabel
type Stored = Entity & Stamps
type Overlap = { id: number; shared: number | string } & { shared: number; extra: boolean }
interface Walker { legs: number; walk(): string }
interface Swimmer { fins: number; swim(): string }
type Amphibian = Walker & Swimmer
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
function idOf(h: HasId): number { return h.id }
function labelOf(h: HasLabel): string { return h.label + (h.note === undefined ? "" : "/" + h.note) }
function age(t: Stamps): number { return (t.updated ?? t.created) - t.created }
const entity: Entity = { label: "e", id: 1 }
const stored: Stored = { created: 100, id: 2, label: "s" }
const both: Stored = { updated: 5, note: "n", label: "b", created: 6, id: 3 }
const ids: HasId[] = [entity, stored, both, { id: 4 }]
const labels: HasLabel[] = [entity, stored, both, { label: "only" }]
const stamps: Stamps[] = [stored, both, { created: 1 }]
console.log(ids.map(idOf).join(), labels.map(labelOf).join(), stamps.map(age).join())
console.log([entity, stored, both].map(show).join(" ; "))
const storedAsLabel: HasLabel = stored
const storedAsStamps: Stamps = stored
storedAsStamps.updated = 150
storedAsLabel.note = "late"
ids[1].id = 20
console.log(show(stored), stored.id, stored.note, stored.updated, age(stored), labelOf(stored))
delete storedAsStamps.updated
storedAsStamps.updated = 101
console.log(show(stored), "updated" in entity, (entity as Partial<Stored>).updated)

const overlap: Overlap = { shared: 2, id: 1, extra: true }
const leftHalf: { id: number; shared: number | string } = overlap
const rightHalf: { shared: number; extra: boolean } = overlap
rightHalf.shared += 0.5
console.log(leftHalf.shared, overlap.shared * 2, typeof leftHalf.shared, show(overlap))

const frog: Amphibian = { legs: 4, fins: 0, walk() { return "walk " + this.legs }, swim() { return "swim " + this.fins + "/" + this.legs } }
const walker: Walker = frog
const swimmer: Swimmer = frog
walker.legs = 2
swimmer.fins = 1
console.log(frog.walk(), frog.swim(), walker.walk(), swimmer.swim(), Object.keys(swimmer).join())

// The two halves are put together by a generic function.
function merge<A extends object, B extends object>(x: A, y: B): A & B { return { ...x, ...y } }
const merged = merge(stored, { extra: [1], id: 77 })
console.log(show(merged), merged.id, merged.extra.length, merged.created, stored.id, idOf(merged), age(merged))
// The second half arrives after creation, by Object.assign. (Such an object seen as that half alone, or cast from any: type-rules/intersection-types.)
function withId<T extends object>(value: T, id: number): T & HasId { return Object.assign(value, { id }) }
const labelled: HasLabel = { label: "grown" }, direct: HasLabel = { label: "direct" }
const grown = withId(labelled, 9), grownDirectly: HasLabel & HasId = Object.assign(direct, { id: 8 })
console.log(grown.id, grown.label, show(labelled), (grown as object) === labelled, grownDirectly.id, show(direct))

// An intersection distributes over a union.
type Painted = ({ kind: "c"; r: number } | { kind: "s"; side: number }) & { colour: string }
function paint(p: Painted): string { return p.colour + (p.kind === "c" ? " circle " + p.r : " square " + p.side) }
const painted: Painted[] = [{ kind: "c", r: 1, colour: "red" }, { colour: "blue", side: 2, kind: "s" }]
const colours: { colour: string }[] = painted
colours[0].colour = "green"
console.log(painted.map(paint).join(), painted.map(show).join(" ; "))

// A branded primitive is a primitive: the object half of the intersection exists in the checker only.
type Brand<T, B extends string> = T & { readonly __brand: B }
type UserId = Brand<number, "user">
type Slug = Brand<string, "slug">
function userId(n: number): UserId { return n as UserId }
function slug(s: string): Slug { return s as Slug }
const users: UserId[] = [userId(5), userId(2.5), userId(-0), userId(NaN)]
const account: { owner: UserId; path: Slug; previous?: UserId } = { owner: users[0], path: slug("a-b") }
console.log(users.map(u => typeof u + (u + 1)).join(), account.owner * 2, account.path.length, account.path.toUpperCase(), account.path + "!", show(account), Object.is(users[2], -0))
account.previous = account.owner
account.owner = userId(account.owner + 1)
console.log(account.owner, account.previous, account.owner > account.previous, new Map<UserId, Slug>([[account.owner, account.path]]).get(userId(6)), `${account.path}/${account.owner}`)

let total = 0
for (let i = 0; i < 3000; i++) total += idOf(ids[i & 3]) + labelOf(labels[i & 3]).length + age(stamps[i % 3])
console.log(total)

// GENERATED: show age merge withId walk
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = Call v5, v4 calleeKey="join" calleeName="join"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = String string=" "
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = Builtin builtin=JSON
// CHECK-NEXT: v11 = PropGet v10 key="stringify"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v10, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Add v9, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="age"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_8]]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="updated"
// CHECK-NEXT: v2 = TypeTest v1 testedType=undefined|null
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = PropGet v0 key="created"
// CHECK-NEXT: Jump -> next b5(v4)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b5(v6):
// CHECK-NEXT: v7 = PropGet v0 key="created"
// CHECK-NEXT: v8 = Sub v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="merge"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_10]] site=[[w_11]]}, {type=undefined|null|[[L_12]] site=[[w_13]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_10]], v1: undefined|null|[[L_12]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = CopyObject v0
// CHECK-NEXT: CopyDataProperties v2, v1
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="withId"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_14]] site=[[w_15]]}, {type=number site=[[w_16]]}] results=[{type=undefined|null|[[L_17]] site=[[w_18]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_14]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectAssign
// CHECK-NEXT: v4 = Convert v1 declared={type=number}
// CHECK-NEXT: v5 = NewObject -, v4 layout=[[L_17]] fields=[0]
// CHECK-NEXT: v6 = FinishObject v5
// CHECK-NEXT: v7 = Call v3, v2, v0, v6 calleeName="Object.assign"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|[[L_17]] site=[[w_19]]}}, {declared={type=undefined|null|[[L_17]] site=[[w_18]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="walk"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = String string="walk "
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_22]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = PropGet v2 key="legs"
// CHECK-NEXT: v4 = Add v1, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
