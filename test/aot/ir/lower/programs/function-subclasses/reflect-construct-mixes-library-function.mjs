// RUN: lower
// OPTIONS: builtin-modules

// new.target and the function that is constructed come from different sides.
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
class Bus extends EventEmitter { constructor() { super(); this.bus = true; } hello() { return "bus"; } }
class Other { constructor() { this.other = true; } hello() { return "other"; } }
function show(o) { return Object.keys(o).join() + " " + (typeof o.hello === "function" ? o.hello() : "-") + " " + (o instanceof EventEmitter) + " " + (o instanceof Bus) + " " + (o instanceof Other); }
console.log(show(Reflect.construct(EventEmitter, [], Bus)));
console.log(show(Reflect.construct(EventEmitter, [], Other)));
console.log(show(Reflect.construct(Bus, [], Other)));
console.log(show(Reflect.construct(Bus, [], EventEmitter)));
console.log(show(Reflect.construct(Other, [], Bus)));
console.log(show(Reflect.construct(Readable, [{ read() {} }], Bus)));
const mixed = Reflect.construct(EventEmitter, [], Other);
try { mixed.on("x", () => {}); } catch (error) { console.log(error.constructor.name); }
const asBus = Reflect.construct(EventEmitter, [], Bus);
asBus.on("x", function () { console.log("heard", this.bus, this.hello()); });
asBus.emit("x");
function NoPrototype() {}
NoPrototype.prototype = 5;
console.log(Object.getPrototypeOf(Reflect.construct(EventEmitter, [], NoPrototype)) === Object.prototype);

// GENERATED: Other hello Bus read
// CHECK-LABEL: function {{*}}name="Other"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Boolean boolean=true
// CHECK-NEXT: v6 = Convert v5 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PropSet v4, v6 key="other"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hello"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="other"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Bus"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstruct v3, v1 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v9) frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_5]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Boolean boolean=true
// CHECK-NEXT: v14 = Convert v13 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: PropSet v12, v14 key="bus"
// CHECK-NEXT: v16 = Undefined
// CHECK-NEXT: v17 = TypeTest v16 testedType=object
// CHECK-NEXT: Branch v17 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v18):
// CHECK-NEXT: Jump -> next b10(v18)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = TypeTest v19 testedType=undefined
// CHECK-NEXT: Branch v20 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v21):
// CHECK-NEXT: v22 = TypeTest v11 testedType=absent
// CHECK-NEXT: Branch v22 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v23) frequency=Unlikely:
// CHECK-NEXT: v24 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v24
// CHECK-NEXT: b9(v25):
// CHECK-NEXT: Jump -> next b10(v25)
// CHECK-NEXT: b10(v26):
// CHECK-NEXT: Return v26
// CHECK-NEXT: b11(v27) frequency=Unlikely:
// CHECK-NEXT: v28 = NewRuntimeError runtimeError=DerivedConstructorResult name="Bus"
// CHECK-NEXT: Throw v28
// CHECK-NEXT: b12(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hello"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="bus"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
