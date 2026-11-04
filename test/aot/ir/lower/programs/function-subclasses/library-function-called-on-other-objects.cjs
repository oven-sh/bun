// RUN: lower
// OPTIONS: builtin-modules

// `EventEmitter.call(x)` and `Readable.call(x)` with receivers that no class of theirs has made.
const EventEmitter = require("node:events");
const { Readable } = require("node:stream");
class Bus extends EventEmitter { constructor() { super(); this.tag = "bus"; } }
class Plain { constructor() { this.tag = "plain"; } }
const literal = { tag: "literal" };
EventEmitter.call(literal);
console.log(Object.keys(literal).join(), typeof literal.on);
const plain = new Plain();
EventEmitter.call(plain);
console.log(Object.keys(plain).join(), plain instanceof EventEmitter);
Object.setPrototypeOf(plain, EventEmitter.prototype);
plain.on("x", function () { console.log("heard by", this.tag); });
plain.emit("x");
const bus = new Bus();
bus.on("x", () => console.log("bus"));
EventEmitter.call(bus);
console.log(bus.listenerCount("x"), bus.emit("x"));
const made = Object.create(Readable.prototype);
Readable.call(made, { read() { this.push(null); } });
made.on("end", () => console.log("ended", made instanceof Readable, Object.keys(made).length > 2));
made.resume();
const returned = Readable.call(literal);
console.log(returned instanceof Readable, literal instanceof Readable, "_readableState" in literal);
for (const receiver of [undefined, null, 1, "s"]) {
  try { console.log(typeof EventEmitter.call(receiver)); } catch (error) { console.log(error.constructor.name); }
}

// GENERATED: Plain Bus read
// CHECK-LABEL: function {{*}}name="Plain"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = String string="plain"
// CHECK-NEXT: PropSet v3, v4 key="tag"
// CHECK-NEXT: v6 = Undefined
// CHECK-NEXT: v7 = TypeTest v6 testedType=object
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b2(v3)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: Jump -> next b2(v8)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Bus"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstruct v3, v1 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]]}
// CHECK-NEXT: v6 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b1(| 0), notTaken b11(| 0)
// CHECK-NEXT: b1(v7):
// CHECK-NEXT: v8 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: v12 = String string="bus"
// CHECK-NEXT: PropSet v11, v12 key="tag"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = TypeTest v14 testedType=object
// CHECK-NEXT: Branch v15 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v16):
// CHECK-NEXT: Jump -> next b9(v16)
// CHECK-NEXT: b5(v17):
// CHECK-NEXT: v18 = TypeTest v17 testedType=undefined
// CHECK-NEXT: Branch v18 -> taken b6(| 0), notTaken b10(| 0)
// CHECK-NEXT: b6(v19):
// CHECK-NEXT: v20 = TypeTest v11 testedType=absent
// CHECK-NEXT: Branch v20 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v21):
// CHECK-NEXT: v22 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v22
// CHECK-NEXT: b8(v23):
// CHECK-NEXT: Jump -> next b9(v23)
// CHECK-NEXT: b9(v24):
// CHECK-NEXT: Return v24
// CHECK-NEXT: b10(v25):
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=DerivedConstructorResult name="Bus"
// CHECK-NEXT: Throw v26
// CHECK-NEXT: b11(v27):
// CHECK-NEXT: v28 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="read"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasThis, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = ToThis v0
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = Null
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="this.push"
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
