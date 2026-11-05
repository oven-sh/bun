// RUN: lower
// OPTIONS: builtin-modules

// `F.prototype = other`, before the first `new` and after it: each object inherits from what the property held when the object was made, and keeps it.
const show = (o: object): string => Object.keys(o).join() + " " + JSON.stringify(o)
const attempt = (label: string, run: () => unknown) => { try { console.log(label, String(run())) } catch (error) { console.log(label, "throws", (error as Error).constructor.name) } }
const kindOf = (o: any): string => (typeof o.kind === "function" ? o.kind() : "no kind")

// Before the first `new`.
interface Early { value: number }
function Early(this: Early, value: number) { this.value = value }
const bornWith = (Early as Function).prototype, assignedEarly = { kind() { return "assigned early" } }
Early.prototype = assignedEarly
const EarlyClass = Early as unknown as new (value: number) => Early
const early = new EarlyClass(1)
console.log(show(early), kindOf(early), Object.getPrototypeOf(early) === assignedEarly, early instanceof EarlyClass, (early as any).constructor === Object, bornWith.constructor === Early, Object.getPrototypeOf(early) === bornWith)

// After the first `new`.
interface Late { value: number }
function Late(this: Late, value: number) { this.value = value }
Late.prototype.kind = function () { return "born with" }
const LateClass = Late as unknown as new (value: number) => Late
const valueIn = (late: Late) => late.value
const older = new LateClass(2), firstPrototype: any = Late.prototype
Late.prototype = { kind() { return "assigned late" } }
const newer = new LateClass(3)
console.log(kindOf(older), kindOf(newer), older instanceof LateClass, newer instanceof LateClass, Object.getPrototypeOf(older) === firstPrototype, valueIn(older) + valueIn(newer), show(older), show(newer))
firstPrototype.kind = function () { return "changed where it is" }
Late.prototype.added = function (this: Late) { return "added " + this.value }
console.log(kindOf(older), kindOf(newer), "added" in older, (newer as any).added())
Late.prototype = firstPrototype
console.log(kindOf(new LateClass(4)), older instanceof LateClass, newer instanceof LateClass)

// What is no object leaves Object.prototype.
for (const notAnObject of [null, undefined, 5, "text", true, Symbol.iterator, 2n]) {
  Late.prototype = notAnObject
  const orphan = new LateClass(5)
  console.log(typeof notAnObject, show(orphan), Object.getPrototypeOf(orphan) === Object.prototype, kindOf(orphan), valueIn(orphan))
  attempt("instanceof:", () => orphan instanceof LateClass)
}

// Every kind of object.
class Modern { kind() { return "an instance of a class" } field = 1 }
const trapped: string[] = []
const candidates: [string, object][] = [
  ["a literal", { kind: () => "a literal" }],
  ["one of its own objects", older],
  ["an object of another function", early],
  ["an instance of a class", new Modern()],
  ["the prototype of a class", Modern.prototype],
  ["an array", Object.assign([1, 2], { kind: () => "an array" })],
  ["a function", Object.assign(function () {}, { kind: () => "a function" })],
  ["the function itself", Late],
  ["an object without a prototype", Object.assign(Object.create(null), { kind: () => "no prototype above" })],
  ["a frozen object", Object.freeze({ kind: () => "frozen", value: "read-only above" })],
  ["a proxy", new Proxy({ kind: () => "behind a proxy" }, { get(target, key, receiver) { trapped.push("get " + String(key)); return Reflect.get(target, key, receiver) }, set(target, key, value, receiver) { trapped.push("set " + String(key)); return Reflect.set(target, key, value, receiver) } })],
]
for (const [label, candidate] of candidates) {
  Late.prototype = candidate
  attempt(label + ":", () => { const made = new LateClass(6); return [show(made), kindOf(made), Object.getPrototypeOf(made) === candidate, made instanceof LateClass, valueIn(made)].join(" ") })
}
console.log(trapped.join())
Late.prototype = firstPrototype

// Every way to store it.
const store = (f: any, prototype: object) => { f.prototype = prototype }
const named = (label: string) => ({ kind: () => label })
const ways: [string, (prototype: object) => unknown][] = [
  ["through a parameter", prototype => store(Late, prototype)],
  ["a computed name", prototype => { (Late as any)["proto" + "type"] = prototype }],
  ["Reflect.set", prototype => Reflect.set(Late, "prototype", prototype)],
  ["Object.assign", prototype => Object.assign(Late, { prototype })],
  ["Object.defineProperty", prototype => Object.defineProperty(Late, "prototype", { value: prototype })],
  ["a destructuring target", prototype => { ({ prototype: Late.prototype } = { prototype }) }],
]
for (const [label, way] of ways) { way(named(label)); console.log(kindOf(new LateClass(7)), JSON.stringify(Object.getOwnPropertyDescriptor(Late, "prototype"), (key, value) => (key === "value" ? undefined : value))) }
Late.prototype = firstPrototype

// In the middle of a construction.
interface Turning { step: number }
function Turning(this: Turning, step: number) { Turning.prototype = named("assigned by construction " + step); this.step = step }
Turning.prototype = named("before any construction")
const TurningClass = Turning as unknown as new (step: number) => Turning
console.log(kindOf(new TurningClass(1)), kindOf(new TurningClass(2)), kindOf(new TurningClass(3)), kindOf(Turning.prototype))
const assignAndGive = (label: string, value: number) => { Late.prototype = named(label); return value }
console.log(kindOf(new LateClass(assignAndGive("assigned by the argument", 8))), kindOf(new LateClass(9)))
Late.prototype = firstPrototype

// The property can be made read-only, and never an accessor.
interface Fixed { value: number }
function Fixed(this: Fixed, value: number) { this.value = value }
const FixedClass = Fixed as unknown as new (value: number) => Fixed
Fixed.prototype = named("the last one")
Object.defineProperty(Fixed, "prototype", { writable: false })
attempt("read-only:", () => { Fixed.prototype = named("too late") })
attempt("read-only, Reflect.set:", () => Reflect.set(Fixed, "prototype", named("too late")))
attempt("an accessor:", () => Object.defineProperty(Fixed, "prototype", { get() { return named("from a getter") } }))
attempt("deleted:", () => delete (Fixed as any).prototype)
console.log(kindOf(new FixedClass(10)), show(new FixedClass(11)))

let total = 0
const rotating = [firstPrototype, { kind: () => "ab" }, { kind: () => "abc" }, null]
for (let round = 0; round < 30000; round++) {
  if (round % 1000 === 0) Late.prototype = rotating[(round / 1000) % rotating.length]
  const made = new LateClass(round & 15)
  total += valueIn(made) + kindOf(made).length
}
Late.prototype = firstPrototype
console.log(total, kindOf(new LateClass(12)), kindOf(older), kindOf(newer))

// GENERATED: Late Modern show set store named
// CHECK-LABEL: function {{*}}name="Late"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_1]] site=[[w_2]]} parameters=[{type=number site=[[w_3]]}] results=[{type=anything}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_5]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Convert v1 declared={type=number site=[[w_6]]}
// CHECK-NEXT: PropSet v2, v3 key="value"
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Modern"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_8]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.keys"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<undefined|null|string> site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v5 = PropGet v4 key="join"
// CHECK-NEXT: v6 = Call v5, v4 calleeKey="join" calleeName="join"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = String string=" "
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = Builtin builtin=JSON
// CHECK-NEXT: v11 = PropGet v10 key="stringify"
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v13 = Call v12, v10, v0 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v15 = Add v9, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=4 thisType={type=anything} parameters=[{type=undefined|null|[[L_14]] site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string|symbol site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}, {type=anything}, {type=anything}] results=[{type=boolean site=[[w_17]]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_14]], v1: undefined|null|string|symbol, v2: anything, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="trapped"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = String string="set "
// CHECK-NEXT: v8 = Builtin builtin=String
// CHECK-NEXT: v9 = Call v8, -, v1 calleeName="String"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v11 = Add v7, v10
// CHECK-NEXT: v12 = Call v6, v5, v11 calleeKey="push" calleeName="trapped.push"
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_21]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v14 = Builtin builtin=Reflect
// CHECK-NEXT: v15 = Builtin builtin=ReflectSet
// CHECK-NEXT: v16 = Call v15, v14, v0, v1, v2, v3 calleeName="Reflect.set"
// CHECK-NEXT: ReturnCall v16 casts=[{declared={type=boolean site=[[w_22]]}}, {declared={type=boolean site=[[w_17]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="store"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|object site=[[w_23]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_24]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_25]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v1 key="prototype"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="named"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_26]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_14]] site=[[w_27]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_28]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_29]]
// CHECK-NEXT: v2 = NewObject -, v1 layout=[[L_14]] fields=[0]
// CHECK-NEXT: v3 = FinishObject v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_14]] site=[[w_27]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
