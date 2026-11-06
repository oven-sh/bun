// RUN: lower
// OPTIONS: builtin-modules

// The `prototype` of a generator function: a writable property that holds an ordinary, extensible object, created at first use, one per closure. Iteration sees what the program puts on that object, on an object above it or on the generator itself.
function said(f) { try { return String(f()) } catch (e) { return "threw " + e.name } }
function* count(n) { for (let i = 0; i < n; i++) yield i }
function* plain(n) { for (let i = 0; i < n; i++) yield i }
async function* countLater(n) { for (let i = 0; i < n; i++) yield i }
const make = () => function* () { yield 1 }
function sum(iterable) { let s = 0; for (const v of iterable) s += v; return s }
function sumDirect(n) { let s = 0; for (const v of count(n)) s += v; return s }
const show = () => [sumDirect(4), sum(count(4)), [...count(3)].join(), (([p, q]) => p + q)(count(5))].join(" ")
const describe = f => [JSON.stringify(Object.getOwnPropertyDescriptor(f, "prototype")), Reflect.ownKeys(f.prototype).length, Object.isExtensible(f.prototype), Object.isFrozen(f.prototype), Object.hasOwn(f.prototype, "constructor"),
  f(0) instanceof f, Object.getPrototypeOf(f(0)) === f.prototype, Reflect.deleteProperty(f, "prototype"), Object.keys(f).length, Object.getOwnPropertyNames(f).sort().join(), said(() => new f())].join(" ")
const usePlain = () => { let total = 0; for (const v of plain(5)) total += v; return total + " " + [...plain(3)].join() }
console.log("plain:", usePlain())
const early = count(1)
console.log("call before read:", Object.getPrototypeOf(early) === count.prototype)
const late = make(), fromLate = late()
console.log("closure call before read:", Object.getPrototypeOf(fromLate) === late.prototype)
const generatorPrototype = Object.getPrototypeOf(count.prototype)
console.log("shared parent:", generatorPrototype === Object.getPrototypeOf(late.prototype))
console.log("declaration:", describe(count))
console.log("unchanged:", show())
{
  const pending = count(3)
  count.prototype.tap = function () { return "tapped " + this.next().value }
  console.log("tap added:", show(), sum(pending), count(3).tap(), early.tap())
  delete count.prototype.tap
  console.log("tap deleted:", show())
}
{
  const pending = count(3)
  count.prototype.next = () => ({ done: true, value: undefined })
  console.log("next added:", show(), sum(pending))
  delete count.prototype.next
  console.log("next deleted:", show())
}
{
  const pending = count(3)
  count.prototype[Symbol.iterator] = () => [7, 8][Symbol.iterator]()
  console.log("Symbol.iterator added:", show(), sum(pending))
  delete count.prototype[Symbol.iterator]
  console.log("Symbol.iterator deleted:", show())
}
let closed = 0
{
  const pending = count(3)
  count.prototype.return = function (v) { closed++; return { done: true, value: v } }
  console.log("return added:", show(), sum(pending))
  for (const v of count(3)) break
  console.log("closed:", closed)
  delete count.prototype.return
  console.log("return deleted:", show())
}
const middle = Object.create(generatorPrototype)
Object.setPrototypeOf(count.prototype, middle)
console.log("middle inserted:", show())
middle.next = () => ({ done: true })
console.log("middle.next added:", show())
delete middle.next
console.log("middle.next deleted:", show())
Object.setPrototypeOf(count.prototype, generatorPrototype)
console.log("middle removed:", show())
const own = count(3); own.next = () => ({ done: true })
console.log("own next:", sum(own), sum(count(3)))
const bare = count(3); Object.setPrototypeOf(bare, { next() { return { done: true } }, [Symbol.iterator]() { return this } })
console.log("own prototype:", sum(bare))
const extended = count(3); extended.note = 1
console.log("own property:", sum(extended), extended.note)
const original = count.prototype, before = count(2)
count.prototype = { kind: "replaced" }
console.log("replaced:", count(1).kind, Object.getPrototypeOf(count(1)) === count.prototype, said(() => count(1).next()), said(() => sumDirect(2)), before instanceof count, sum(before))
const chained = Object.create(generatorPrototype, { kind: { value: "chained" } }); count.prototype = chained
console.log("chained:", count(1).kind, show())
count.prototype = 5
console.log("replaced by 5:", Object.getPrototypeOf(count(1)) === generatorPrototype, said(() => count(1) instanceof count), show())
count.prototype = null
console.log("replaced by null:", Object.getPrototypeOf(count(1)) === generatorPrototype, said(() => count(1) instanceof count), show())
const kinds = []
for (let i = 0; i < 6; i++) { count.prototype = i & 1 ? original : chained; kinds.push(String(count(1).kind)) }
console.log("alternating:", kinds.join())
count.prototype = original
console.log("restored:", describe(count), show())
const fixed = make(); Object.defineProperty(fixed, "prototype", { writable: false })
console.log("read-only:", Reflect.set(fixed, "prototype", {}), sum(fixed()))
const frozen = make(); Object.freeze(frozen.prototype)
console.log("frozen:", Object.isFrozen(frozen.prototype), Reflect.set(frozen.prototype, "next", 1), sum(frozen()))
const redefined = make(), other = Object.create(generatorPrototype); Object.defineProperty(redefined, "prototype", { value: other })
console.log("redefined:", Object.getPrototypeOf(redefined()) === other)
const f = make(), g = make()
console.log("two closures:", f.prototype !== g.prototype, f() instanceof f, f() instanceof g)
f.prototype.mark = 1
console.log("mark:", f().mark, g().mark)
console.log("1000 closures:", new Set(Array.from({ length: 1000 }, () => make().prototype)).size)
function outer(n) { function* inner() { yield n } return [inner(), inner] }
const [it1, fn1] = outer(1), [it2, fn2] = outer(2)
console.log("escaping direct call:", Object.getPrototypeOf(it1) === fn1.prototype, Object.getPrototypeOf(it1) === Object.getPrototypeOf(it2), fn1.prototype === fn2.prototype, sum(it1) + sum(it2))
class K { *m() { yield 1 } static *s() { yield 2 } }
const literal = { *m() { yield 3 } }
const expression = function* () { yield 4 }
console.log("method:", describe(K.prototype.m))
console.log("static method:", describe(K.s))
console.log("literal method:", describe(literal.m))
console.log("expression:", describe(expression))
console.log("distinct prototypes:", new Set([K.prototype.m.prototype, K.s.prototype, literal.m.prototype, expression.prototype]).size)
console.log("sums:", sum(new K().m()), sum(K.s()), sum(literal.m()), sum(expression()))
console.log("plain:", usePlain())
console.log("async:", describe(countLater))
console.log("async shared parent:", Object.getPrototypeOf(countLater.prototype) === Object.getPrototypeOf((async function* () {}).prototype))
countLater.prototype.extra = 1
console.log("async extra:", countLater(0).extra)
const makeLater = () => async function* () {}
console.log("async closures:", makeLater().prototype !== makeLater().prototype)
;(async () => { let s = 0; for await (const v of countLater(4)) s += v; countLater.prototype.next = async () => ({ done: true }); for await (const v of countLater(4)) s += 100; return s })().then(s => console.log(s))

// GENERATED: said sum outer K [Symbol.iterator] inner
// CHECK-LABEL: function {{*}}name="said"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = Builtin builtin=String
// CHECK-NEXT: v2 = Call v0 calleeName="f"
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="String"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = String string="threw "
// CHECK-NEXT: v7 = PropGet v5 key="name"
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v3
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v10 = Add v4, v8
// CHECK-NEXT: v11 = Convert v10 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v11)
// CHECK-NEXT: b7() role=IterationCleanup subject=v3:
// CHECK-NEXT: v12 = CatchException
// CHECK-NEXT: IteratorClose v3 completion=Throw
// CHECK-NEXT: Rethrow v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="outer"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array<undefined|null|[[f_1]]|Generator> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_2]]
// CHECK-NEXT: v2 = Convert v1 declared={type=[[f_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v3 = Call v2 calleeName="inner"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Generator flags=[IsExpected]}
// CHECK-NEXT: v5 = NewArray v4, v2 contents=undefined|null|[[f_1]]|Generator
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<undefined|null|[[f_1]]|Generator> flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="K"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsNamedByComputedKey] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="inner"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, HasExplicitName] captures=[{type=anything}] thisType={type=anything} results=[{type=undefined|null|Generator flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = Convert v0 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v5 = Yield v4
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: Switch v7 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
