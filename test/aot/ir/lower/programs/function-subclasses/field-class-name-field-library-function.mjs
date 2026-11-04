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
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_2]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Early"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstruct v3, v1 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]]}
// CHECK-NEXT: v6 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b1(| 0), notTaken b11(| 0)
// CHECK-NEXT: b1(v7):
// CHECK-NEXT: v8 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = Null
// CHECK-NEXT: v13 = NewClosure function=[[f_4]]
// CHECK-NEXT: v14 = NewObject -, v13 layout=[[L_5]] fields=[0]
// CHECK-NEXT: SetLiteralPrototype v14, v12
// CHECK-NEXT: v16 = FinishObject v14
// CHECK-NEXT: PropSet v11, v16 key="_events"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = TypeTest v18 testedType=object
// CHECK-NEXT: Branch v19 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v20):
// CHECK-NEXT: Jump -> next b9(v20)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: v22 = TypeTest v21 testedType=undefined
// CHECK-NEXT: Branch v22 -> taken b6(| 0), notTaken b10(| 0)
// CHECK-NEXT: b6(v23):
// CHECK-NEXT: v24 = TypeTest v11 testedType=absent
// CHECK-NEXT: Branch v24 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v25):
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v26
// CHECK-NEXT: b8(v27):
// CHECK-NEXT: Jump -> next b9(v27)
// CHECK-NEXT: b9(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: b10(v29):
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=DerivedConstructorResult name="Early"
// CHECK-NEXT: Throw v30
// CHECK-NEXT: b11(v31):
// CHECK-NEXT: v32 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="own"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, HasExplicitName] thisType={type=[[L_6]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_6]]):
// CHECK-NEXT: v1 = PropGet v0 key="_readableState"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="a"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = String string="planted"
// CHECK-NEXT: v6 = Call v4, v2, v5 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: ReturnCall v6
// CHECK-NEXT: }
