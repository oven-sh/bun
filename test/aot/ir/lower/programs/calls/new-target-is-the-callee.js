// RUN: lower
// OPTIONS: builtin-modules

class Base { constructor() { this.x = 1; this.on = new.target.name; } }
class Derived extends Base { constructor() { super(); this.y = 2; } }
class Other extends Base { constructor() { super(); this.z = 3; } }
function Plain() { this.p = new.target === Plain ? "own" : new.target && new.target.name; }
function Second() { this.s = new.target === Second ? "own" : new.target && new.target.name; }
function show(o) { return Object.getPrototypeOf(o).constructor.name + ":" + Object.keys(o).join(",") + ":" + Object.values(o).join(","); }
const lines = [];
for (let i = 0; i < 6; i++) {
  lines.push(show(new (i % 2 ? Derived : Other)()));
  lines.push(show(new (i % 3 ? Plain : Second)()));
  lines.push(show(new (i % 3 === 0 ? Derived : i % 3 === 1 ? Plain : Base)()));
}
lines.push(show(Reflect.construct(Derived, [], Other)));
lines.push(show(Reflect.construct(Other, [], Derived)));
lines.push(show(Reflect.construct(Plain, [], Second)));
lines.push(show(Reflect.construct(Base, [], Plain)));
const table = [Derived, Other, Plain, Second, Base];
for (const C of table) lines.push(show(new C()));
const bound = Derived.bind(null);
lines.push(show(new bound()));
lines.push(show(new (lines.length > 3 ? bound : Other)()));
console.log(lines.join("\n"));

// GENERATED: show Derived
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|object flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|object):
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v4 = PropGet v3 key="constructor"
// CHECK-NEXT: v5 = PropGet v4 key="name"
// CHECK-NEXT: v6 = String string=":"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Builtin builtin=Object
// CHECK-NEXT: v9 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v10 = Call v9, v8, v0 calleeName="Object.keys"
// CHECK-NEXT: v11 = PropGet v10 key="join"
// CHECK-NEXT: v12 = String string=","
// CHECK-NEXT: v13 = Call v11, v10, v12 calleeKey="join" calleeName="join"
// CHECK-NEXT: v14 = Add v7, v13
// CHECK-NEXT: v15 = String string=":"
// CHECK-NEXT: v16 = Add v14, v15
// CHECK-NEXT: v17 = Builtin builtin=Object
// CHECK-NEXT: v18 = Builtin builtin=ObjectValues
// CHECK-NEXT: v19 = Call v18, v17, v0 calleeName="Object.values"
// CHECK-NEXT: v20 = PropGet v19 key="join"
// CHECK-NEXT: v21 = String string=","
// CHECK-NEXT: v22 = Call v20, v19, v21 calleeKey="join" calleeName="join"
// CHECK-NEXT: v23 = Add v16, v22
// CHECK-NEXT: Return v23
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
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
// CHECK-NEXT: v12 = Integer integer=2
// CHECK-NEXT: PropSet v11, v12 key="y"
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
// CHECK-NEXT: v26 = NewRuntimeError runtimeError=DerivedConstructorResult name="Derived"
// CHECK-NEXT: Throw v26
// CHECK-NEXT: b11(v27):
// CHECK-NEXT: v28 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v28
// CHECK-NEXT: }
