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
