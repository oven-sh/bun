// RUN: lower
// OPTIONS: builtin-modules

// for-of over an object whose @@iterator is a generator method: every way that belief can end
const out = [];
function say(...a) { out.push(a.join(" ")); }
class Bag {
  constructor(...v) { this.v = v; }
  *[Symbol.iterator]() { for (let i = 0; i < this.v.length; i++) yield this.v[i]; }
}
class Twice extends Bag { *[Symbol.iterator]() { for (const x of this.v) { yield x; yield x; } } }
class Plain extends Bag { [Symbol.iterator]() { return this.v[Symbol.iterator](); } }
class Below extends Bag {}
function sum(b) { let s = 0; for (const x of b) s += x; return s; }
function first(b) { for (const x of b) return x; return -1; }
function spread(b) { return [...b].join(); }
function destructure(b) { const [p, q = "none"] = b; return p + ":" + q; }
function warm(b) { let s = 0; for (let i = 0; i < 300; i++) s += sum(b) + first(b); return s; }
const a = new Bag(1, 2, 3), t = new Twice(1, 2), p = new Plain(4, 5), w = new Below(6, 7);
say("warm", warm(a), warm(t), warm(p), warm(w), spread(a), spread(t), destructure(a), destructure(new Bag(1)));
// the order of events: the method is read, called, next is read once
const log = [];
const watched = new Proxy(a, { get(o, k, r) { log.push(String(k)); return Reflect.get(o, k, o); } });
say("proxy", sum(watched), log.join());
// an own @@iterator
const own = new Bag(1, 2, 3);
own[Symbol.iterator] = function* () { yield 50; };
say("own", sum(own), first(own), spread(own), sum(a));
delete own[Symbol.iterator];
say("own gone", sum(own));
// return() is called when the loop is left
class Closing { *[Symbol.iterator]() { try { yield 1; yield 2; } finally { say("finally ran"); } } }
say("left early", first(new Closing()));
try { for (const x of new Closing()) throw new Error("out"); } catch (e) { say("thrown out", e.message); }
outer: for (const x of new Closing()) { for (const y of new Closing()) continue outer; }
// the generators' own prototype gets a next | return
const mine = Bag.prototype[Symbol.iterator].prototype;
mine.next = function () { return { done: true }; };
say("next on the function's prototype", sum(a), sum(w), sum(t));
delete mine.next;
say("and gone", sum(a), sum(w));
mine.return = function (v) { say("my return"); return { done: true, value: v }; };
say("return on the function's prototype", first(a), first(t));
delete mine.return;
function attempt(name, f) { try { f(); say(name, "done"); } catch (e) { say(name, e.constructor.name); } }
// the method is replaced later
const old = Bag.prototype[Symbol.iterator];
Bag.prototype[Symbol.iterator] = function* () { yield 1000; };
say("replaced", sum(a), sum(w), sum(t), sum(p), first(a), spread(a), destructure(a));
Bag.prototype[Symbol.iterator] = function () { let n = 0; return { next() { return n++ < 2 ? { done: false, value: 7 } : { done: true } }, return() { say("object's return"); return {}; } }; };
say("replaced by a protocol object", sum(a), first(a), sum(w));
Bag.prototype[Symbol.iterator] = function () { return 5; };
attempt("gives a number", () => sum(a));
Bag.prototype[Symbol.iterator] = 5;
attempt("is a number", () => sum(a));
delete Bag.prototype[Symbol.iterator];
attempt("deleted", () => sum(a));
say("heirs with their own", sum(t), sum(p));
Object.defineProperty(Bag.prototype, Symbol.iterator, { get() { say("getter"); return old; }, configurable: true });
say("getter", sum(a), sum(w));
Object.defineProperty(Bag.prototype, Symbol.iterator, { value: old, writable: true, configurable: true });
say("restored", sum(a), sum(w), warm(a));
// the object's prototype moves
const moved = new Bag(1, 2, 3);
say("moved before", sum(moved));
Object.setPrototypeOf(moved, Twice.prototype); say("moved", sum(moved));
Object.setPrototypeOf(moved, Array.prototype); attempt("moved to Array.prototype", () => say(sum(moved)));
Object.setPrototypeOf(moved, null); attempt("moved to null", () => sum(moved));
// the list changes while it is walked; the generator throws; yields in a try
const growing = new Bag(1, 2); let n = 0; for (const x of growing) { if (n++ < 3) growing.v.push(x + 10); } say("growing", growing.v.join());
class Thrower { *[Symbol.iterator]() { yield 1; throw new RangeError("inside"); } }
attempt("throws inside", () => sum(new Thrower()));
class Args { *[Symbol.iterator]() { yield arguments.length; yield this === undefined; yield new.target === undefined; } }
say("arguments", spread(new Args()));
class Nested { constructor(k) { this.k = k; } *[Symbol.iterator]() { if (this.k > 0) { yield this.k; yield* new Nested(this.k - 1); } } }
say("nested", spread(new Nested(4)), sum(new Nested(10)));
say("uses", Array.from(a).join(), new Set(a).size, Math.max(...a), new Map([[1, a]]).get(1) === a, Object.fromEntries(new Bag(["k", 1]))["k"]);
Promise.all(new Bag(1, Promise.resolve(2))).then(v => { say("all", v.join()); console.log(out.join("\n")); });

// GENERATED: spread destructure Twice Closing next
// CHECK-LABEL: function {{*}}name="spread"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewArray contents=anything
// CHECK-NEXT: AppendSpread v1, v0
// CHECK-NEXT: v3 = Convert v1 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="join"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_1]] flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v5, v3 calleeKey="join" calleeName="join"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=undefined|null|string flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="destructure"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=2 [isDestructuring]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b10():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b10():
// CHECK-NEXT: v5 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v6 = ResultAt v5
// CHECK-NEXT: v7 = ResultAt v5 index=1
// CHECK-NEXT: v8 = TypeTest v7 testedType=undefined
// CHECK-NEXT: Branch v8 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v9) handler=b10():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b10():
// CHECK-NEXT: v10 = String string="none"
// CHECK-NEXT: Jump -> next b7(v10)
// CHECK-NEXT: b6(v11) handler=b10():
// CHECK-NEXT: Jump -> next b7(v11)
// CHECK-NEXT: b7(v12) handler=b10():
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v14 = String string=":"
// CHECK-NEXT: v15 = Add v4, v14
// CHECK-NEXT: v16 = Add v15, v12
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: b10() role=IterationCleanup subject=v1:
// CHECK-NEXT: v18 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Closing"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="next"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] captures=[{type=env [[L_5]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=undefined|null|[[L_6]] flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: env [[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetEnvironmentField v0 layout=[[L_5]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="n"
// CHECK-NEXT: v3 = ToNumeric v2
// CHECK-NEXT: v4 = Increment v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = GetEnvironmentField v0 layout=[[L_5]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="n"
// CHECK-NEXT: PutEnvironmentField v0, v5 layout=[[L_5]]
// CHECK-NEXT: v9 = Integer integer=2
// CHECK-NEXT: v10 = Less v3, v9
// CHECK-NEXT: Branch v10 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = Data data=[[d_8]]
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Data data=[[d_9]]
// CHECK-NEXT: Jump -> next b4(v12)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
