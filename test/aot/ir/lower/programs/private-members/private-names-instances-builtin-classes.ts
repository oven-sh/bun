// RUN: lower
// OPTIONS: builtin-modules

// Private fields, methods, accessors, static private members and `#name in` on instances of classes that extend Map, Set, Error, Promise, Array, Uint8Array, EventTarget and Function. A built-in constructor creates these objects, so they have no slot for a private name.
function said(f: () => unknown): string { try { return String(f()) } catch (e) { return "threw " + (e as Error).name } }
function show(...parts: unknown[]): void { console.log(parts.join(" | ")) }
type Box = { n: number }

class OnMap extends Map<string, number> {
  #field: number = 1
  #text: string = "map"
  #box: Box = { n: 0 }
  static #made: number = 0
  static #count(): number { return ++OnMap.#made }
  static get #label(): string { return "OnMap " + OnMap.#made }
  constructor() { super([["a", 1]]); OnMap.#count() }
  #method(): string { return this.#text + this.#field + ":" + this.#box.n + ":" + this.size }
  get #accessor(): number { return this.#field * 2 }
  set #accessor(value: number) { this.#field = value / 2 }
  use(): string { this.#field++; this.#accessor += 2; this.#text += "!"; this.#box = { n: this.#box.n + 1 }; return this.#method() + " " + this.#accessor }
  static create(): OnMap { return new OnMap() }
  static has(o: object): string { return [#field in o, #text in o, #box in o, #method in o, #accessor in o].join() }
  static hasStatic(o: object): string { return [#made in o, #count in o, #label in o].join() }
  static read(o: any): string { return said(() => o.#field + " " + o.#method() + " " + o.#accessor) }
  static write(o: any, value: number): string { return said(() => { o.#field = value; o.#accessor += 2; o.#box = { n: value }; return o.#field + ":" + o.#box.n }) }
  static label(): string { return OnMap.#label }
}

class OnSet extends Set<number> {
  #field: number = 1
  #text: string = "set"
  #box: Box = { n: 0 }
  static #made: number = 0
  static #count(): number { return ++OnSet.#made }
  static get #label(): string { return "OnSet " + OnSet.#made }
  constructor() { super([1, 2]); OnSet.#count() }
  #method(): string { return this.#text + this.#field + ":" + this.#box.n + ":" + this.size }
  get #accessor(): number { return this.#field * 2 }
  set #accessor(value: number) { this.#field = value / 2 }
  use(): string { this.#field++; this.#accessor += 2; this.#text += "!"; this.#box = { n: this.#box.n + 1 }; return this.#method() + " " + this.#accessor }
  static create(): OnSet { return new OnSet() }
  static has(o: object): string { return [#field in o, #text in o, #box in o, #method in o, #accessor in o].join() }
  static hasStatic(o: object): string { return [#made in o, #count in o, #label in o].join() }
  static read(o: any): string { return said(() => o.#field + " " + o.#method() + " " + o.#accessor) }
  static write(o: any, value: number): string { return said(() => { o.#field = value; o.#accessor += 2; o.#box = { n: value }; return o.#field + ":" + o.#box.n }) }
  static label(): string { return OnSet.#label }
}

class OnError extends Error {
  #field: number = 1
  #text: string = "error"
  #box: Box = { n: 0 }
  static #made: number = 0
  static #count(): number { return ++OnError.#made }
  static get #label(): string { return "OnError " + OnError.#made }
  constructor() { super("failed"); OnError.#count() }
  #method(): string { return this.#text + this.#field + ":" + this.#box.n + ":" + this.message }
  get #accessor(): number { return this.#field * 2 }
  set #accessor(value: number) { this.#field = value / 2 }
  use(): string { this.#field++; this.#accessor += 2; this.#text += "!"; this.#box = { n: this.#box.n + 1 }; return this.#method() + " " + this.#accessor }
  static create(): OnError { return new OnError() }
  static has(o: object): string { return [#field in o, #text in o, #box in o, #method in o, #accessor in o].join() }
  static hasStatic(o: object): string { return [#made in o, #count in o, #label in o].join() }
  static read(o: any): string { return said(() => o.#field + " " + o.#method() + " " + o.#accessor) }
  static write(o: any, value: number): string { return said(() => { o.#field = value; o.#accessor += 2; o.#box = { n: value }; return o.#field + ":" + o.#box.n }) }
  static label(): string { return OnError.#label }
}

class OnPromise extends Promise<number> {
  #field: number = 1
  #text: string = "promise"
  #box: Box = { n: 0 }
  static #made: number = 0
  static #count(): number { return ++OnPromise.#made }
  static get #label(): string { return "OnPromise " + OnPromise.#made }
  constructor(...list: any[]) { super(...(list as [any])); OnPromise.#count() }
  #method(): string { return this.#text + this.#field + ":" + this.#box.n + ":" + typeof this.then }
  get #accessor(): number { return this.#field * 2 }
  set #accessor(value: number) { this.#field = value / 2 }
  use(): string { this.#field++; this.#accessor += 2; this.#text += "!"; this.#box = { n: this.#box.n + 1 }; return this.#method() + " " + this.#accessor }
  static create(): OnPromise { return new OnPromise((resolve: (value: number) => void) => resolve(1)) }
  static has(o: object): string { return [#field in o, #text in o, #box in o, #method in o, #accessor in o].join() }
  static hasStatic(o: object): string { return [#made in o, #count in o, #label in o].join() }
  static read(o: any): string { return said(() => o.#field + " " + o.#method() + " " + o.#accessor) }
  static write(o: any, value: number): string { return said(() => { o.#field = value; o.#accessor += 2; o.#box = { n: value }; return o.#field + ":" + o.#box.n }) }
  static label(): string { return OnPromise.#label }
}

class OnArray extends Array<number> {
  #field: number = 1
  #text: string = "array"
  #box: Box = { n: 0 }
  static #made: number = 0
  static #count(): number { return ++OnArray.#made }
  static get #label(): string { return "OnArray " + OnArray.#made }
  constructor(...list: any[]) { super(...list); OnArray.#count() }
  #method(): string { return this.#text + this.#field + ":" + this.#box.n + ":" + this.length }
  get #accessor(): number { return this.#field * 2 }
  set #accessor(value: number) { this.#field = value / 2 }
  use(): string { this.#field++; this.#accessor += 2; this.#text += "!"; this.#box = { n: this.#box.n + 1 }; return this.#method() + " " + this.#accessor }
  static create(): OnArray { return new OnArray(2) }
  static has(o: object): string { return [#field in o, #text in o, #box in o, #method in o, #accessor in o].join() }
  static hasStatic(o: object): string { return [#made in o, #count in o, #label in o].join() }
  static read(o: any): string { return said(() => o.#field + " " + o.#method() + " " + o.#accessor) }
  static write(o: any, value: number): string { return said(() => { o.#field = value; o.#accessor += 2; o.#box = { n: value }; return o.#field + ":" + o.#box.n }) }
  static label(): string { return OnArray.#label }
}

class OnBytes extends Uint8Array {
  #field: number = 1
  #text: string = "bytes"
  #box: Box = { n: 0 }
  static #made: number = 0
  static #count(): number { return ++OnBytes.#made }
  static get #label(): string { return "OnBytes " + OnBytes.#made }
  constructor(...list: any[]) { super(...(list as [any, any?, any?])); OnBytes.#count() }
  #method(): string { return this.#text + this.#field + ":" + this.#box.n + ":" + this.byteLength }
  get #accessor(): number { return this.#field * 2 }
  set #accessor(value: number) { this.#field = value / 2 }
  use(): string { this.#field++; this.#accessor += 2; this.#text += "!"; this.#box = { n: this.#box.n + 1 }; return this.#method() + " " + this.#accessor }
  static create(): OnBytes { return new OnBytes(4) }
  static has(o: object): string { return [#field in o, #text in o, #box in o, #method in o, #accessor in o].join() }
  static hasStatic(o: object): string { return [#made in o, #count in o, #label in o].join() }
  static read(o: any): string { return said(() => o.#field + " " + o.#method() + " " + o.#accessor) }
  static write(o: any, value: number): string { return said(() => { o.#field = value; o.#accessor += 2; o.#box = { n: value }; return o.#field + ":" + o.#box.n }) }
  static label(): string { return OnBytes.#label }
}

class OnTarget extends EventTarget {
  #field: number = 1
  #text: string = "target"
  #box: Box = { n: 0 }
  static #made: number = 0
  static #count(): number { return ++OnTarget.#made }
  static get #label(): string { return "OnTarget " + OnTarget.#made }
  constructor() { super(); OnTarget.#count(); this.addEventListener("grow", () => { this.#field += 100 }) }
  #method(): string { return this.#text + this.#field + ":" + this.#box.n + ":" + this.dispatchEvent(new Event("grow")) + this.#field }
  get #accessor(): number { return this.#field * 2 }
  set #accessor(value: number) { this.#field = value / 2 }
  use(): string { this.#field++; this.#accessor += 2; this.#text += "!"; this.#box = { n: this.#box.n + 1 }; return this.#method() + " " + this.#accessor }
  static create(): OnTarget { return new OnTarget() }
  static has(o: object): string { return [#field in o, #text in o, #box in o, #method in o, #accessor in o].join() }
  static hasStatic(o: object): string { return [#made in o, #count in o, #label in o].join() }
  static read(o: any): string { return said(() => o.#field + " " + o.#method() + " " + o.#accessor) }
  static write(o: any, value: number): string { return said(() => { o.#field = value; o.#accessor += 2; o.#box = { n: value }; return o.#field + ":" + o.#box.n }) }
  static label(): string { return OnTarget.#label }
}

class OnFunction extends Function {
  #field: number = 1
  #text: string = "function"
  #box: Box = { n: 0 }
  static #made: number = 0
  static #count(): number { return ++OnFunction.#made }
  static get #label(): string { return "OnFunction " + OnFunction.#made }
  constructor() { super("return 7"); OnFunction.#count() }
  #method(): string { return this.#text + this.#field + ":" + this.#box.n + ":" + this.call(null) }
  get #accessor(): number { return this.#field * 2 }
  set #accessor(value: number) { this.#field = value / 2 }
  use(): string { this.#field++; this.#accessor += 2; this.#text += "!"; this.#box = { n: this.#box.n + 1 }; return this.#method() + " " + this.#accessor }
  static create(): OnFunction { return new OnFunction() }
  static has(o: object): string { return [#field in o, #text in o, #box in o, #method in o, #accessor in o].join() }
  static hasStatic(o: object): string { return [#made in o, #count in o, #label in o].join() }
  static read(o: any): string { return said(() => o.#field + " " + o.#method() + " " + o.#accessor) }
  static write(o: any, value: number): string { return said(() => { o.#field = value; o.#accessor += 2; o.#box = { n: value }; return o.#field + ":" + o.#box.n }) }
  static label(): string { return OnFunction.#label }
}

const subjects: any[] = [OnMap, OnSet, OnError, OnPromise, OnArray, OnBytes, OnTarget, OnFunction]
const levels: [string, (o: any) => unknown][] = [["freeze", Object.freeze], ["seal", Object.seal], ["preventExtensions", Object.preventExtensions]]
let garbage: object[] = []
function allocate(): void { garbage = []; for (let i = 0; i < 100000; i++) garbage.push({ i }) }

for (const Subject of subjects) {
  const name: string = Subject.name
  const first = Subject.create(), second = Subject.create()
  show(name, first.use(), first.use(), second.use(), Subject.read(first), Subject.write(first, 10), Subject.read(first), Subject.read(second), Subject.label())
  show(name, "tests", Subject.has(first), Subject.hasStatic(first), Subject.hasStatic(Subject), Subject.has(Subject), Subject.has(Object.create(first)), Subject.has(new Proxy(first, {})), Object.getOwnPropertySymbols(first).length)
  const others = subjects.filter(Other => Other !== Subject)
  show(name, "in the other classes", [...new Set(others.map(Other => [Other.has(first), Other.read(first), Other.write(first, 1)].join(" ")))].join(" / "))
  for (const [level, apply] of levels) {
    const o = Subject.create()
    show(name, level, said(() => { apply(o); return "done" }), o.use(), o.use(), Subject.write(o, 20), Subject.read(o), Subject.has(o), Object.isFrozen(o), Object.isSealed(o), Object.isExtensible(o))
  }
  const kept: any[] = []
  for (let i = 0; i < 300; i++) kept.push(Subject.create())
  Bun.gc(true)
  for (let i = 0; i < kept.length; i++) { kept[i].use(); if (i % 3 === 0) Subject.write(kept[i], i) }
  allocate()
  show(name, "300 instances", new Set(kept.map(o => Subject.has(o))).size, kept.reduce((total, o) => total + Subject.read(o).length, 0), Subject.read(kept[0]), Subject.read(kept[1]), Subject.read(kept[299]))
}

for (const value of [5, "text", true, null, undefined, Symbol.iterator, 5n]) show("on " + String(value), OnMap.read(value), OnMap.write(value, 1), said(() => OnMap.has(value as any)), said(() => OnMap.hasStatic(value as any)))

class Deeper extends OnMap {
  #field: string = "deep"
  #own(): string { return this.#field + this.size }
  both(): string { this.#field += "er"; return this.#own() + " " + this.use() }
  static hasDeeper(o: object): string { return [#field in o, #own in o].join() }
}
const deep = new Deeper()
show("a subclass of OnMap", deep.both(), deep.both(), OnMap.has(deep), Deeper.hasDeeper(deep), Deeper.hasDeeper(new OnMap()), OnMap.read(deep), OnMap.hasStatic(Deeper), Deeper.label())

const mapped = OnArray.create().map(x => x), copied = OnArray.from([1, 2, 3]), sliced = OnBytes.create().slice(1), viewed = OnBytes.create().subarray(1, 3)
show("made by Array.prototype.map", mapped instanceof OnArray, OnArray.has(mapped), OnArray.read(mapped))
show("made by Array.from", copied instanceof OnArray, OnArray.has(copied), OnArray.read(copied))
show("made by slice", sliced instanceof OnBytes, OnBytes.has(sliced), OnBytes.read(sliced))
show("made by subarray", viewed instanceof OnBytes, OnBytes.has(viewed), OnBytes.read(viewed))

const evaluations: any[] = []
for (let i = 0; i < 3; i++) {
  evaluations.push(class extends Set<number> {
    #id: number = i
    #next(): number { return this.#id += 10 }
    get #label(): string { return "set " + this.#id + ":" + this.size }
    static has(o: object): string { return [#id in o, #next in o, #label in o].join() }
    static read(o: any): string { return said(() => o.#id + " " + o.#next() + " " + o.#label) }
    static write(o: any, value: number): string { return said(() => (o.#id = value)) }
  })
}
const instances = evaluations.map(Evaluation => new Evaluation([1]))
for (let i = 0; i < 3; i++) {
  for (let j = 0; j < 3; j++) show("evaluation " + i, "instance " + j, evaluations[i].has(instances[j]), evaluations[i].read(instances[j]), evaluations[i].write(instances[j], 5 + i), evaluations[i].read(instances[j]))
}

type Constructor = new (...args: any[]) => object
const Tagged = <T extends Constructor>(Base: T) => class extends Base {
  #tag: number = 1
  #bump(): number { return ++this.#tag }
  static has(o: object): string { return [#tag in o, #bump in o].join() }
  static bump(o: any): string { return said(() => o.#bump()) }
}
const Once = Tagged(Map), Twice = Tagged(Once), Thrice = Tagged(Twice), Apart = Tagged(Map)
const stacked = new Thrice()
show("three evaluations on one Map", Once.has(stacked), Twice.has(stacked), Thrice.has(stacked), Apart.has(stacked))
show("each evaluation counts alone", Once.bump(stacked), Twice.bump(stacked), Twice.bump(stacked), Thrice.bump(stacked), Thrice.bump(stacked), Thrice.bump(stacked), Once.bump(stacked), Apart.bump(stacked))
show("fewer evaluations on another Map", Once.has(new Twice()), Twice.has(new Twice()), Thrice.has(new Twice()), Thrice.bump(new Twice()), Twice.bump(new Once()), Once.bump(new Once()))

class Identity { constructor(o: any) { return o } }
class Stamp extends Identity {
  #mark: number = 1
  #touch(): number { return ++this.#mark }
  get #twice(): number { return this.#mark * 2 }
  set #twice(value: number) { this.#mark = value / 2 }
  static has(o: object): string { return [#mark in o, #touch in o, #twice in o].join() }
  static touch(o: any): string { return said(() => { o.#twice = o.#touch() * 4; return o.#mark + " " + o.#twice }) }
}
class Marks extends Identity {
  #first: string = "first"
  #second: number = 2
  static has(o: object): string { return [#first in o, #second in o].join() }
  static read(o: any): string { return said(() => o.#first + o.#second) }
  static write(o: any, text: string): string { return said(() => { o.#first = text; return ++o.#second }) }
}
const foreign: [string, () => object][] = [
  ["a Map", () => new Map()],
  ["a Set", () => new Set()],
  ["an Error", () => new Error("e")],
  ["a Promise", () => Promise.resolve(1)],
  ["an Array", () => [1, 2]],
  ["a Uint8Array", () => new Uint8Array(2)],
  ["an EventTarget", () => new EventTarget()],
  ["a Function", () => new Function("return 1")],
  ["a closure", () => () => 1],
  ...subjects.map((Subject): [string, () => object] => ["new " + Subject.name, () => Subject.create()]),
]
for (const [title, create] of foreign) {
  const o = create()
  show(title, "before", Stamp.has(o), Stamp.touch(o), Marks.has(o), Marks.read(o), Marks.write(o, "early"))
  show(title, "stamped", said(() => new Stamp(o) === o), Stamp.has(o), Stamp.touch(o), Stamp.touch(o), said(() => new Marks(o) === o), Marks.has(o), Marks.read(o), Marks.write(o, "later"), Marks.read(o))
  show(title, "stamped twice", said(() => new Stamp(o)), said(() => new Marks(o)), Stamp.touch(o), Marks.read(o), Object.getOwnPropertySymbols(o).length)
  const frozen = create()
  show(title, "frozen first", said(() => Object.isFrozen(Object.freeze(frozen))), said(() => new Stamp(frozen) === frozen), Stamp.has(frozen), Stamp.touch(frozen), said(() => new Marks(frozen) === frozen), Marks.write(frozen, "frozen"), Marks.read(frozen))
  const later = create()
  show(title, "frozen later", said(() => new Stamp(later) === later), said(() => new Marks(later) === later), said(() => Object.isFrozen(Object.freeze(later))), Stamp.touch(later), Marks.write(later, "frozen"), Marks.read(later), said(() => new Stamp(later)), said(() => new Marks(later)))
}

const chained = OnPromise.create().then(value => value + 1)
show("made by then", chained instanceof OnPromise, OnPromise.has(chained), OnPromise.read(chained), await chained)
export {}

// GENERATED: OnArray hasDeeper Tagged #bump
// CHECK-LABEL: function {{*}}name="OnArray"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array site=[[w_1]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v5, v2
// CHECK-NEXT: v7 = SuperConstructList v4, v1, v5 layout=[[L_3]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = CallDirect v8 function=[[f_4]]
// CHECK-NEXT: v12 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v13 = CheckInitialized v12 name="OnArray"
// CHECK-NEXT: v14 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v15 = StrictEq v13, v14
// CHECK-NEXT: Branch v15 -> taken b3(), notTaken b11()
// CHECK-NEXT: b3():
// CHECK-NEXT: v16 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v17 = Call v16, v13 calleeName="OnArray.#count"
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_8]]}
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: v20 = TypeTest v19 testedType=object
// CHECK-NEXT: Branch v20 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v21):
// CHECK-NEXT: Jump -> next b9(v21)
// CHECK-NEXT: b5(v22):
// CHECK-NEXT: v23 = TypeTest v22 testedType=undefined
// CHECK-NEXT: Branch v23 -> taken b6(| 0), notTaken b10(| 0)
// CHECK-NEXT: b6(v24):
// CHECK-NEXT: v25 = TypeTest v8 testedType=absent
// CHECK-NEXT: Branch v25 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v26) frequency=Unlikely:
// CHECK-NEXT: v27 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v27
// CHECK-NEXT: b8(v28):
// CHECK-NEXT: Jump -> next b9(v28)
// CHECK-NEXT: b9(v29):
// CHECK-NEXT: Return v29
// CHECK-NEXT: b10(v30) frequency=Unlikely:
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=DerivedConstructorResult name="OnArray"
// CHECK-NEXT: Throw v31
// CHECK-NEXT: b11() frequency=Unlikely:
// CHECK-NEXT: v32 = NewRuntimeError runtimeError=InvalidPrivateBrand
// CHECK-NEXT: Throw v32
// CHECK-NEXT: b12(v33) frequency=Unlikely:
// CHECK-NEXT: v34 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hasDeeper"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v2 = PrivateHas v0, v1 layout=[[L_12]] field=1
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v4 = PrivateHas v0, v3 layout=[[L_12]]
// CHECK-NEXT: v5 = NewArray v2, v4 contents=boolean
// CHECK-NEXT: v6 = PropGet v5 key="join"
// CHECK-NEXT: v7 = Call v6, v5 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v7 casts=[{declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Tagged"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_14]] site=[[w_15]]}] results=[{type=undefined|null|[[f_16]] site=[[w_17]]}] functionTypes={{*}}[[f_18]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_14]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ResolveHeritage v0
// CHECK-NEXT: v2 = NewClassToken layout=[[L_19]]
// CHECK-NEXT: v3 = NewClosure v2 function=[[f_20]]
// CHECK-NEXT: v4 = NewClass v3, v0, v1 layout=[[L_19]]
// CHECK-NEXT: v5 = NewClosure v2 function=[[f_21]]
// CHECK-NEXT: v6 = NewClosure v2, v5 function=[[f_22]]
// CHECK-NEXT: DefineMethod v4, v6 layout=[[L_19]] side=Static key="has"
// CHECK-NEXT: v8 = NewClosure v2, v5 function=[[f_23]]
// CHECK-NEXT: DefineMethod v4, v8 layout=[[L_19]] side=Static index=1 key="bump"
// CHECK-NEXT: v10 = FinishClass v4 layout=[[L_19]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_16]] site=[[w_17]]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#bump"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] captures=[{type=classtoken flags=[IsFromCompiler]}] thisType={type=[[L_19]] site=[[w_24]]} results=[{type=number site=[[w_25]]}] {
// CHECK-NEXT: b0(v0: classtoken, v1: [[L_19]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PrivateGet v1, v0 layout=[[L_19]] field=1
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_26]]}
// CHECK-NEXT: PrivateSet v1, v0, v4 layout=[[L_19]] field=1
// CHECK-NEXT: v6 = Convert v3 declared={type=number site=[[w_25]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
