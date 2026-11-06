// RUN: lower
// OPTIONS: builtin-modules

// Private fields, methods and accessors: a public property with the same spelling is unrelated, look-alike objects are rejected, and freezing does not affect private fields.
// #private names, TypeScript's `private`, parameter properties and statics, on objects also seen through interfaces, `any`, proxies and Object.create.
interface Owned { owner: string; level: number }
function attempt(f: () => unknown): string { try { return String(f()) } catch (e) { return (e as Error).constructor.name } }
class Vault implements Owned {
  static #made = 0
  static count() { return Vault.#made }
  static isVault(o: object): o is Vault { return #secret in o }
  static peek(o: Vault): number { return o.#secret }
  #secret: number
  #log: string[] = []
  private soft = "soft"
  protected guard = true
  constructor(secret: number, public owner: string, readonly level: number = 1) { this.#secret = secret; Vault.#made++ }
  reveal(): number { this.#log.push("r"); return this.#secret }
  bump(by: number): this { this.#secret += by; this.#log.push("b"); return this }
  get history(): string { return this.#log.join("") }
  #hidden(): number { return this.#secret * 2 }
  twice(): number { return this.#hidden() }
  equals(o: Vault): boolean { return this.#secret === o.#secret }
  softly(): string { return this.soft + this.guard }
}
class Deep extends Vault {
  #secret = "deep"
  both(): string { return this.#secret + this.reveal() }
  static isDeep(o: object): boolean { return #secret in o }
}
const v = new Vault(7, "ann", 2), w = new Vault(7, "bob"), d = new Deep(1, "cy")
console.log(v.reveal(), v.bump(3).bump(0.5).reveal(), v.twice(), v.history, v.equals(w), w.equals(w), Vault.count(), v.softly())
console.log(Object.keys(v).join(), JSON.stringify(v), JSON.stringify(d), Object.getOwnPropertyNames(v).length, Reflect.ownKeys(d).length)
console.log(d.both(), Vault.peek(d), Vault.isVault(d), Deep.isDeep(d), Deep.isDeep(v), d.equals(new Vault(1, "x")))
// A property by the same spelling is another thing.
const loose: any = v
console.log(loose["#secret"], "#secret" in loose, loose.soft, loose.guard)
loose["#secret"] = "public"
console.log(v.reveal(), loose["#secret"], Object.keys(v).join())
delete loose["#secret"]
// Objects that look like a Vault but were not made by its constructor, held as what they are. (Held as a Vault or an Owned: type-rules/private-members.)
const heir: any = Object.create(v)
const wrapped: any = new Proxy(v as object, {})
const fake: any = { owner: "f", level: 0 }
console.log(heir.owner, heir.level, attempt(() => heir.reveal()), attempt(() => wrapped.reveal()), attempt(() => Vault.peek(fake)), attempt(() => v.equals(fake)))
console.log(attempt(() => Vault.prototype.twice.call(fake)), attempt(() => wrapped.history), attempt(() => heir.bump(1)), wrapped.owner)
console.log(Vault.isVault(heir), Vault.isVault(wrapped), Vault.isVault(fake), Vault.isVault({}), Vault.isVault(v), v.history)
// Freezing does not reach private names.
Object.freeze(w)
console.log(w.bump(1).reveal(), attempt(() => { w.owner = "z" }), w.owner, w.history, Object.isFrozen(w))
function ownerOf(o: Owned): string { return o.owner + o.level }
const owners: Owned[] = [v, w, d, { owner: "lit", level: 9 }]
console.log(owners.map(o => ownerOf(o)).join())
for (const o of owners) if (!Object.isFrozen(o)) o.owner += "'"
console.log(owners.map(o => ownerOf(o)).join())
// Private accessors and private static methods.
class Meter {
  #n = 0
  get #next(): number { return ++this.#n }
  set #next(x: number) { this.#n = x * 2 }
  tick(): number { return this.#next }
  reset(x: number): number { this.#next = x; return this.#n }
  static #helper(m: Meter): number { return m.#n + 100 }
  static read(m: Meter): number { return Meter.#helper(m) }
}
const meter = new Meter()
console.log(meter.tick(), meter.tick(), meter.reset(5), meter.tick(), Meter.read(meter), attempt(() => Meter.read({} as Meter)), Object.keys(meter).length)
// A private field that is read, through a method, before the constructor has stored to it.
class Early {
  #value: number
  #text = "t"
  first: string
  constructor(value: number) { this.first = this.show(); this.#value = value }
  show(): string { return String(this.#value) + this.#text }
}
const early = new Early(4)
console.log(early.first, early.show(), JSON.stringify(early))
let sum = 0
const vaults = [v, d, new Vault(0.5, "n"), new Deep(2, "m")]
for (let i = 0; i < 80; i++) sum += vaults[i % 4].bump(i % 3).reveal() + Vault.peek(vaults[(i + 1) % 4])
console.log(sum, vaults.map(x => x.history.length).join())

// GENERATED: count isVault #next read Deep
// CHECK-LABEL: function {{*}}name="count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_1]]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Vault"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = StrictEq v1, v2
// CHECK-NEXT: Branch v3 -> taken b2(), notTaken b5()
// CHECK-NEXT: b2():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v5 = TypeTest v4 testedType=absent
// CHECK-NEXT: Branch v5 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v6) frequency=Unlikely:
// CHECK-NEXT: v7 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b4(v8):
// CHECK-NEXT: v9 = Convert v8 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: Return v9
// CHECK-NEXT: b5() frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=InvalidPrivateRead
// CHECK-NEXT: Throw v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="isVault"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_6]]}] {
// CHECK-NEXT: b0(v0: undefined|null|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_7]]
// CHECK-NEXT: v2 = PrivateHas v0, v1 layout=[[L_8]] field=3
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_6]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_9]] site=[[w_10]]} results=[{type=number site=[[w_11]]}] {
// CHECK-NEXT: b0(v0: [[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_9]] field=1
// CHECK-NEXT: v3 = Increment v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_13]]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: PrivateSet v0, v5, v4 layout=[[L_9]] field=1
// CHECK-NEXT: v7 = Convert v3 declared={type=number site=[[w_11]]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="#next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_9]] site=[[w_14]]} parameters=[{type=number site=[[w_15]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_9]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer integer=2
// CHECK-NEXT: v3 = Mul v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_13]]}
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_12]]
// CHECK-NEXT: PrivateSet v0, v5, v4 layout=[[L_9]] field=1
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_9]] site=[[w_16]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_17]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_18]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="Meter"
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_19]]
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: Branch v4 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = GetModuleVariable variable=[[g_20]]
// CHECK-NEXT: v6 = Call v5, v2, v0 calleeName="Meter.#helper"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=number site=[[w_21]]}}, {declared={type=number site=[[w_17]]}}]
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v7 = NewRuntimeError runtimeError=InvalidPrivateBrand
// CHECK-NEXT: Throw v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Deep"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_22]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_23]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_23]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_24]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
