// RUN: lower
// OPTIONS: builtin-modules

// The class declares, with other kinds of values, names that the function of the library stores into the same object.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
class Odd extends EventEmitter { _eventsCount = "many"; _maxListeners = 1; }
const odd = new Odd();
odd.on("a", () => {});
console.log(odd._eventsCount, odd._maxListeners, odd.getMaxListeners(), odd.listenerCount("a"), Object.keys(odd).join());
class Early extends EventEmitter { constructor() { super(); this._events = { __proto__: null, a: () => console.log("planted") }; } }
console.log(new Early().emit("a"), new Early().eventNames().join());
class Hidden extends Readable {
  _readableState = "mine";
  get own() { return this._readableState; }
}
const hidden = new Hidden();
console.log(hidden.own, typeof hidden._readableState);
try { console.log(hidden.readableFlowing); } catch (error) { console.log(error.constructor.name); }
class Accessor extends EventEmitter {
  get _events() { return this.kept; }
  set _events(value) { this.kept = value; this.stores = (this.stores ?? 0) + 1; }
}
const accessor = new Accessor();
accessor.on("x", () => {});
console.log(accessor.stores, accessor.listenerCount("x"), Object.keys(accessor).join());

// GENERATED: Odd Early own a
// CHECK-LABEL: function {{*}}name="Odd"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_2]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Early"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstruct v3, v1 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v9) frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Null
// CHECK-NEXT: v14 = NewClosure function=[[f_4]]
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v16 = NewObject layout=[[L_6]]
// CHECK-NEXT: SetLiteralPrototype v16, v13
// CHECK-NEXT: PropDefine v16, v15 key="a"
// CHECK-NEXT: v19 = FinishObject v16
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v12, v20 key="_events"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: v23 = TypeTest v22 testedType=object
// CHECK-NEXT: Branch v23 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v24):
// CHECK-NEXT: Jump -> next b10(v24)
// CHECK-NEXT: b6(v25):
// CHECK-NEXT: v26 = TypeTest v25 testedType=undefined
// CHECK-NEXT: Branch v26 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v27):
// CHECK-NEXT: v28 = TypeTest v11 testedType=absent
// CHECK-NEXT: Branch v28 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b9(v31):
// CHECK-NEXT: Jump -> next b10(v31)
// CHECK-NEXT: b10(v32):
// CHECK-NEXT: Return v32
// CHECK-NEXT: b11(v33) frequency=Unlikely:
// CHECK-NEXT: v34 = NewRuntimeError runtimeError=DerivedConstructorResult name="Early"
// CHECK-NEXT: Throw v34
// CHECK-NEXT: b12(v35) frequency=Unlikely:
// CHECK-NEXT: v36 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v36
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="own"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_7]] flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: [[L_7]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="_readableState"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="a"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="planted"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
