// RUN: lower
// OPTIONS: builtin-modules

// A base constructor stores under a name for which the class of new.target has an accessor or a read-only property. On such an instance the store creates nothing: the setter runs, or the store
// throws in strict code, and the instance never has the property. Instances of the base itself exist too and get the property. Each family has classes of its own, so that what one row reads
// or lists does not change what is known about another.
const log = [];

function Tagged(v) { this.tag = v; }
class Logged extends Tagged { set tag(v) { log.push("setter " + v); } }
new Logged(1); new Tagged(2);
console.log("function, nobody reads:", log.join());

class Valued { constructor(v) { this.value = v; } }
const Observable = Parent => class extends Parent {
  set value(v) { this.stored = v * 2; }
  get value() { return this.stored; }
};
const Watched = Observable(Valued);
const valued = new Valued(1);
const watched = new Watched(21);
console.log("mixin:", watched.value, watched.stored, Object.keys(watched).join(), valued instanceof Valued);

function Owned(v) { this.own = v; }
class NotOwned extends Owned { set own(v) { this.got = v; } }
const notOwned = new NotOwned(1), owned = new Owned(2);
console.log("own property:", Object.hasOwn(notOwned, "own"), Object.hasOwn(owned, "own"), "own" in notOwned, notOwned.own, owned.own, notOwned.got);

class Listed { constructor(v) { this.first = v; this.second = v + 1; } }
class Shorter extends Listed { set first(v) { this.third = v; } }
console.log("keys:", Object.keys(new Shorter(1)).join(), Object.keys(new Listed(2)).join(), JSON.stringify(new Shorter(3)), JSON.stringify(new Listed(4)));

function Fixed(v) { try { this.fixed = v; this.thrown = "nothing"; } catch (error) { this.thrown = error.name; } }
class GetterAlone extends Fixed { get fixed() { return "getter"; } }
class ReadOnly extends Fixed {}
Object.defineProperty(ReadOnly.prototype, "fixed", { value: "read-only", writable: false });
for (const made of [new GetterAlone(1), new ReadOnly(2), new Fixed(3)]) console.log("refused:", made.thrown, made.fixed, Object.keys(made).join());

class Deep { constructor(v) { this.deep = v; } }
class Middle extends Deep { set deep(v) { log.push("middle " + v); } }
class Lowest extends Middle {}
log.length = 0;
new Lowest(1); new Middle(2); new Deep(3);
console.log("two levels:", log.join());

class Later { constructor(v) { this.later = v; } }
class StoresAgain extends Later {
  constructor(v) { super(v); this.later = v + 1; }
  set later(v) { log.push("later " + v); }
}
log.length = 0;
new StoresAgain(1); new Later(5);
console.log("store after super:", log.join());

class Defined { constructor(v) { this.defined = v; } }
class DefinesOwn extends Defined {
  constructor(v) { super(v); Object.defineProperty(this, "defined", { value: "own", writable: true, enumerable: true, configurable: true }); this.defined = "stored"; }
  set defined(v) { log.push("defined " + v); }
}
log.length = 0;
const definesOwn = new DefinesOwn(1); new Defined(2);
console.log("own data over the setter:", log.join(), definesOwn.defined, Object.keys(definesOwn).join());

function Counted(v) { this.count = v; }
class Counting extends Counted { set count(v) { Counting.total += v; } }
Counting.total = 0;
let kept = 0;
for (let i = 0; i < 20000; i++) {
  new Counting(i & 3);
  kept += new Counted(i & 1).count;
}
console.log("in a loop:", Counting.total, kept);

// GENERATED: Fixed Observable Shorter StoresAgain
// CHECK-LABEL: function {{*}}name="Fixed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: PropSet v0, v1 key="fixed"
// CHECK-NEXT: v3 = String string="nothing"
// CHECK-NEXT: PropSet v0, v3 key="thrown"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v5 = CatchValue
// CHECK-NEXT: v6 = PropGet v5 key="name"
// CHECK-NEXT: PropSet v0, v6 key="thrown"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Observable"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_2]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_2]]):
// CHECK-NEXT: v1 = ResolveHeritage v0
// CHECK-NEXT: v2 = NewClosure function=[[f_3]]
// CHECK-NEXT: v3 = NewClass v2, v0, v1 layout=[[L_4]]
// CHECK-NEXT: v4 = NewClosure function=[[f_5]]
// CHECK-NEXT: DefineMethod v3, v4 layout=[[L_4]] methodKind=Setter key="value"
// CHECK-NEXT: v6 = NewClosure function=[[f_6]]
// CHECK-NEXT: DefineMethod v3, v6 layout=[[L_4]] methodKind=Getter index=1 key="value"
// CHECK-NEXT: v8 = FinishClass v3 layout=[[L_4]]
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Shorter"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_8]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_8]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="StoresAgain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_10]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_10]]}
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b11(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: v13 = Integer integer=1
// CHECK-NEXT: v14 = Add v2, v13
// CHECK-NEXT: PropSet v12, v14 key="later"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = TypeTest v16 testedType=object
// CHECK-NEXT: Branch v17 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: Jump -> next b9(v18)
// CHECK-NEXT: b5(v19):
// CHECK-NEXT: v20 = TypeTest v19 testedType=undefined
// CHECK-NEXT: Branch v20 -> taken b6(| 0), notTaken b10(| 0)
// CHECK-NEXT: b6(v21):
// CHECK-NEXT: v22 = TypeTest v12 testedType=absent
// CHECK-NEXT: Branch v22 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v23):
// CHECK-NEXT: v24 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v24
// CHECK-NEXT: b8(v25):
// CHECK-NEXT: Jump -> next b9(v25)
// CHECK-NEXT: b9(v26):
// CHECK-NEXT: Return v26
// CHECK-NEXT: b10(v27):
// CHECK-NEXT: v28 = NewRuntimeError runtimeError=DerivedConstructorResult name="StoresAgain"
// CHECK-NEXT: Throw v28
// CHECK-NEXT: b11(v29):
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v30
// CHECK-NEXT: }
