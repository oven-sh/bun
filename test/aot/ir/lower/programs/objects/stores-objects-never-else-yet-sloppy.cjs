// RUN: lower
// OPTIONS: builtin-modules

// `const o = {}; o.a = ..; o.b = ..`: at the top level (run once), in functions, in loops and behind branches. Until the function hands the object on, nobody else can have changed it.
// Each case hands it on, or changes it, at another point: what is stored behind that point has to see the change.
const lines = [];
const describe = object => Reflect.ownKeys(object).map(String).join() + " " + JSON.stringify(Object.getOwnPropertyDescriptors(object), (key, value) => typeof value === "function" ? "function" : typeof value === "symbol" ? String(value) : value) + " " + (Object.isFrozen(object) ? "frozen" : Object.isSealed(object) ? "sealed" : Object.isExtensible(object) ? "open" : "closed");
const attempt = work => { try { return work(); } catch (error) { return error.constructor.name; } };
let seen = [];

const exportsAtTopLevel = {};
exportsAtTopLevel.first = () => 1;
exportsAtTopLevel.second = "two";
exportsAtTopLevel.third = exportsAtTopLevel.first;
exportsAtTopLevel.fourth = 4;
exportsAtTopLevel.second = 2;
exportsAtTopLevel.fifth = [5];
lines.push("top level: " + describe(exportsAtTopLevel));

const cases = {
  plain(i) { const o = {}; o.a = i; o.b = "b"; o.c = [i]; return o; },
  withFields(i) { const o = { a: i, z: 0 }; o.b = i + 1; o.a = "again"; o.c = i + 2; return o; },
  frozenBetween(i) { "use strict"; const o = {}; o.a = i; Object.freeze(o); seen.push(attempt(() => { o.b = i; return "stored"; })); return o; },
  closedBetween(i) { "use strict"; const o = {}; o.a = i; Object.preventExtensions(o); seen.push(attempt(() => { o.b = i; return "stored"; })); o.a = i + 1; return o; },
  handedOn(i, change) { const o = {}; o.a = i; change(o); o.b = i; o.c = i; return o; },
  capturedByClosure(i) { const o = {}; o.a = i; const later = () => Object.defineProperty(o, "b", { value: "defined", writable: false, configurable: true }); later(); o.b = i; o.c = i; return o; },
  storedIntoItself(i) { const o = {}; o.a = i; o.self = o; Object.defineProperty(o.self, "b", { get() { return "getter"; }, set(value) { seen.push("setter " + value); }, configurable: true, enumerable: true }); o.b = i; delete o.self; return o; },
  otherPrototypeByStore(i) { const o = {}; o.a = i; o.__proto__ = { set b(value) { seen.push("inherited setter " + value + " " + (this === o)); }, get c() { return "inherited"; } }; o.b = i; o.c = i; o.d = i; return o; },
  otherPrototypeInLiteral(i) { const o = { __proto__: { set b(value) { seen.push("setter below literal " + value); Object.freeze(this); } }, a: i }; o.b = i; o.c = i; return o; },
  otherPrototypeByCall(i) { const o = {}; o.a = i; Object.setPrototypeOf(o, { set b(value) { seen.push("setter by call " + value); } }); o.b = i; o.c = i; return o; },
  deletedBetween(i) { const o = {}; o.a = i; o.b = i; delete o.a; o.c = i; o.a = "back"; return o; },
  sameNameOtherTypes(i) { const o = {}; o.a = i; o.a = "text"; o.a = { i }; o.b = 1.5; o.b = i; return o; },
  computedBetween(i, change, key) { const o = {}; o.a = i; o[key] = "computed"; o.b = i; o.c = i; return o; },
  accessorBetween(i) { const o = {}; o.a = i; Object.defineProperty(o, "c", { get() { return "getter"; }, configurable: true }); o.b = i; seen.push(attempt(() => { "use strict"; o.c = i; return "stored"; })); return o; },
  behindBranches(i) { const o = {}; if (i & 1) o.a = i; else o.b = i; o.c = i; if (i & 2) { o.a = "late"; Object.freeze(o); } o.d = i; return o; },
  allocatedOutsideLoop(i, change) { const o = {}; for (let k = 0; k < 3; k++) { o.a = k; o["b" + k] = k; o.c = k; if (k === 1) change(o); } return o; },
  allocatedInsideLoop(i, change) { let last; for (let k = 0; k < 3; k++) { const o = {}; o.a = k; o.b = i; if (k === 1) change(o); o.c = k; last = o; } return last; },
  readBetween(i) { const o = { get twice() { seen.push("getter ran"); Object.freeze(this); return 2; } }; o.a = i; o.b = o.twice; o.c = i; return o; },
  thrownBetween(i) { const o = {}; o.a = i; try { o.b = (() => { throw o; })(); } catch (thrown) { Object.freeze(thrown); } o.c = i; return o; },
  yielded: i => { function* g() { const o = {}; o.a = i; const sent = yield o; o.b = sent; o.c = i; return o; } const it = g(); Object.freeze(it.next().value); return it.next("sent").value; },
  symbolsAndNumbers(i) { const o = {}; o.a = i; o[Symbol.iterator] = i; o[0] = i; o.b = i; o["1"] = i; return o; },
  classInstance(i) { class C { constructor() { this.a = i; this.b = i; } set c(value) { seen.push("class setter " + value); } } const o = new C(); o.c = i; o.d = i; return o; },
  nullPrototype(i) { const o = Object.create(null); o.a = i; o.b = i; return o; },
};
const changes = [o => {}, o => Object.freeze(o), o => Object.defineProperty(o, "b", { value: "fixed", writable: false, enumerable: true }), o => { o.b = "early"; o.z = 1; }, o => Object.setPrototypeOf(o, { set c(value) { seen.push("late setter " + value); } }), o => delete o.a];
for (const [label, make] of Object.entries(cases)) {
  for (let which = 0; which < changes.length; which++) {
    seen = [];
    let last;
    for (let i = 0; i < 6; i++) last = attempt(() => make(i, changes[which], ["b", "c", "x", "a"][i & 3]));
    lines.push(label + " " + which + ": " + (typeof last === "object" ? describe(last) : last) + " | " + seen.join());
    if (make.length < 2) break;
  }
}
console.log(lines.join("\n"));

// GENERATED: classInstance nullPrototype later twice g
// CHECK-LABEL: function {{*}}name="classInstance"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = NewClosure v1 function=[[f_4]]
// CHECK-NEXT: v3 = NewClass v2 layout=[[L_2]]
// CHECK-NEXT: v4 = NewClosure v0 function=[[f_5]]
// CHECK-NEXT: DefineMethod v3, v4 layout=[[L_2]] methodKind=Setter key="c"
// CHECK-NEXT: v6 = FinishClass v3 layout=[[L_2]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = Convert v6 declared={type=[[f_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = Construct v8 calleeName="C"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v10, v1 key="c" mode=Sloppy
// CHECK-NEXT: PropSet v10, v1 key="d" mode=Sloppy
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="nullPrototype"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v3 = Null
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeName="Object.create"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v5, v0 key="a" mode=Sloppy
// CHECK-NEXT: PropSet v5, v0 key="b" mode=Sloppy
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] captures=[{type=undefined|null|[[L_8]] flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|[[L_8]] flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectDefineProperty
// CHECK-NEXT: v3 = String string="b"
// CHECK-NEXT: v4 = String string="defined"
// CHECK-NEXT: v5 = Boolean
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: v7 = NewObject -, v4 layout=[[L_10]] fields=[4]
// CHECK-NEXT: PropDefine v7, v6 key="writable"
// CHECK-NEXT: v9 = Boolean boolean=true
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|boolean flags=[IsExpected]}
// CHECK-NEXT: PropDefine v7, v10 key="configurable"
// CHECK-NEXT: v12 = FinishObject v7
// CHECK-NEXT: v13 = Call v2, v1, v0, v3, v12 calleeName="Object.defineProperty"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[IsSloppy, HasThis, HasExplicitName] captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} results=[{type=number flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ToThis v1
// CHECK-NEXT: v3 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="seen"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v7 = String string="getter ran"
// CHECK-NEXT: v8 = Call v6, v4, v7 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectFreeze
// CHECK-NEXT: v11 = Convert v2 declared={type=undefined|null|[[L_12]] flags=[IsExpected]}
// CHECK-NEXT: v12 = Call v10, v9, v11 calleeName="Object.freeze"
// CHECK-NEXT: v13 = Integer integer=2
// CHECK-NEXT: v14 = Convert v13 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, IsSloppy, HasThis, TakesCallee, HasExplicitName] captures=[{type=anything}] thisType={type=anything} results=[{type=undefined|null|Generator<undefined|null|[[L_8]]> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything, v2: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = ToThis v1
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v5 = Data data=[[d_13]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v6, v0 key="a" mode=Sloppy
// CHECK-NEXT: v8 = Yield v6
// CHECK-NEXT: v9 = ResultAt v8
// CHECK-NEXT: v10 = ResultAt v8 index=1
// CHECK-NEXT: Switch v10 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: PropSet v6, v9 key="b" mode=Sloppy
// CHECK-NEXT: PropSet v6, v0 key="c" mode=Sloppy
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
