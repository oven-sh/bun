// RUN: lower
// OPTIONS: builtin-modules

// Mapped types (`Partial`, `Required`, `Readonly`, `Pick`, `Omit`, `Record`, and user-defined ones) are further types of the same objects.
interface Settings { width: number; height: number; title: string; dark?: boolean }
type Nullable<T> = { [K in keyof T]: T[K] | null }
type Getters<T> = { [K in keyof T as `get_${string & K}`]: () => T[K] }
type Flags3 = Record<"a" | "b" | "c", boolean>
type Counts = Record<string, number>
function show(o: object): string { return Object.keys(o).join() + " " + JSON.stringify(o) }
const base: Settings = { width: 1, height: 2, title: "t" }
const partial: Partial<Settings> = { height: 5 }
const partialOfBase: Partial<Settings> = base
const required: Required<Settings> = { dark: false, title: "r", height: 3, width: 4 }
const readonlyView: Readonly<Settings> = base
const picked: Pick<Settings, "width" | "title"> = base
const pickedFresh: Pick<Settings, "width" | "title"> = { title: "p", width: 6 }
const omitted: Omit<Settings, "title"> = required
const omittedFresh: Omit<Settings, "title" | "dark"> = { height: 7, width: 8 }
function area(s: Partial<Settings>): number { return (s.width ?? 10) * (s.height ?? 10) }
function titleOf(s: Partial<Settings>): string { return s.title ?? "untitled" }
function isDark(s: Partial<Settings>): string { return String(s.dark) + ("dark" in s ? "+" : "-") }
const parts: Partial<Settings>[] = [partial, partialOfBase, required, pickedFresh, omittedFresh, {}]
console.log(parts.map(area).join(), parts.map(titleOf).join(), parts.map(isDark).join())
console.log(parts.map(show).join(" ; "))

partialOfBase.width = 100
partialOfBase.dark = true
picked.title = "picked"
console.log(show(base), readonlyView.width, readonlyView.dark, base.title, Object.isFrozen(readonlyView), picked.width)
delete partialOfBase.dark
console.log(show(base), base.dark, isDark(base), delete partialOfBase.dark)
partial.title = "late"
partial.width = 0
console.log(show(partial), area(partial), titleOf(partial))
omitted.dark = true
omitted.width = -0
console.log(show(required), required.dark, Object.is(required.width, -0), (omitted as Settings).title)

const nullable: Nullable<Settings> = { width: null, height: 2, title: null, dark: null }
const nullableBase: Nullable<Settings> = base
function orZero(n: Nullable<Settings>): string { return [n.width ?? "w", n.height ?? "h", n.title ?? "t", n.dark === null ? "null" : n.dark === undefined ? "none" : n.dark].join("/") }
console.log(orZero(nullable), orZero(nullableBase), show(nullable))
nullable.width = 3
nullable.dark = undefined
console.log(orZero(nullable), show(nullable), "dark" in nullable)

const getters: Getters<Pick<Settings, "width" | "title">> = { get_title: () => base.title, get_width: () => base.width }
console.log(getters.get_width() + 1, getters.get_title().length, Object.keys(getters).join())

// A record over three literal keys has three fields; the keys may still arrive as values. (One of the three deleted through the dictionary: type-rules/mapped-types.)
const flags: Flags3 = { c: true, a: false, b: true }
const order = ["a", "b", "c"] as const
console.log(order.map(k => flags[k]).join(), show(flags))
for (const k of order) flags[k] = !flags[k]
console.log(flags.a, flags.b, flags.c, show(flags))
const asDictionary: Record<string, boolean> = flags
asDictionary.d = true
asDictionary["a"] = false
asDictionary.b = false
delete asDictionary.d
asDictionary.d = true
const seen: string[] = []
for (const k in asDictionary) seen.push(k + "=" + asDictionary[k])
console.log(seen.join(), show(flags), flags.a, flags.b, flags.c)

// A dictionary: any key, keys that look like indices first, a missing key reads as undefined.
const counts: Counts = {}
for (const word of "the cat and the dog and the bird".split(" ")) counts[word] = (counts[word] ?? 0) + 1
const special: string = "toString"
counts[3] = 3; counts["1"] = 1; counts[special] = 9; counts["__x"] = -0
console.log(show(counts), counts.the, counts["and"], counts.missing === undefined, "missing" in counts, (counts.absent || 0) + 1, counts[special] + 1, typeof counts.valueOf)
delete counts.the
counts.the = 1
console.log(Object.keys(counts).join(), Object.values(counts).reduce((x, y) => x + y, 0))

// A mapped type over the keys of a value.
const palette = { red: 1, green: 2, blue: 3 }
type Names = { [K in keyof typeof palette]: string }
const names: Names = { blue: "b", red: "r", green: "g" }
function pairUp(k: keyof typeof palette): string { return names[k] + palette[k] }
console.log((Object.keys(palette) as (keyof typeof palette)[]).map(pairUp).join(), show(names))

let total = 0
for (let i = 0; i < 3000; i++) total += area(parts[i % parts.length]) + titleOf(parts[i % parts.length]).length
console.log(total)

// GENERATED: show area isDark get_title
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
// CHECK-LABEL: function {{*}}name="area"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_7]]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="width"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|number} illTypedCause=Assertion
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined|null
// CHECK-NEXT: Branch v3 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Integer integer=10
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5(v6)
// CHECK-NEXT: b5(v7):
// CHECK-NEXT: v8 = PropGet v0 key="height"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|number} illTypedCause=Assertion
// CHECK-NEXT: v10 = TypeTest v9 testedType=undefined|null
// CHECK-NEXT: Branch v10 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v12 = Integer integer=10
// CHECK-NEXT: Jump -> next b9(v12)
// CHECK-NEXT: b8(v13):
// CHECK-NEXT: Jump -> next b9(v13)
// CHECK-NEXT: b9(v14):
// CHECK-NEXT: v15 = Mul v7, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isDark"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = PropGet v0 key="dark"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|boolean} illTypedCause=Assertion
// CHECK-NEXT: v4 = Call v1, -, v3 calleeName="String"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v6 = PropHas v0 key="dark"
// CHECK-NEXT: v7 = ToBoolean v6
// CHECK-NEXT: Branch v7 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v8):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = String string="+"
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v11 = String string="-"
// CHECK-NEXT: Jump -> next b6(v11)
// CHECK-NEXT: b6(v12):
// CHECK-NEXT: v13 = Add v5, v12
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get_title"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="base"
// CHECK-NEXT: v2 = PropGet v1 key="title"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
