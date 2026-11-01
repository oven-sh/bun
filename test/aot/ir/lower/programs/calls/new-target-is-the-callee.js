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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|object flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|object):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Object
// CHECK-NEXT: v2 = Builtin builtin=ObjectGetPrototypeOf
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Object.getPrototypeOf"
// CHECK-NEXT: v4 = PropGet v3 key="constructor"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="name"
// CHECK-NEXT: v7 = String string=":"
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v11 = Call v10, v9, v0 calleeName="Object.keys"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="join"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v15 = String string=","
// CHECK-NEXT: v16 = Call v14, v12, v15 calleeKey="join" calleeName="join"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v18 = Add v8, v17
// CHECK-NEXT: v19 = String string=":"
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: v21 = Builtin builtin=Object
// CHECK-NEXT: v22 = Builtin builtin=ObjectValues
// CHECK-NEXT: v23 = Call v22, v21, v0 calleeName="Object.values"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="join"
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|[[f_2]] flags=[IsExpected]}
// CHECK-NEXT: v27 = String string=","
// CHECK-NEXT: v28 = Call v26, v24, v27 calleeKey="join" calleeName="join"
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v30 = Add v20, v29
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstruct v3, v1 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: v8 = TypeTest v5 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v9) frequency=Unlikely:
// CHECK-NEXT: v10 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v13 = Integer integer=2
// CHECK-NEXT: v14 = Convert v13 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v12, v14 key="y"
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
// CHECK-NEXT: v28 = NewRuntimeError runtimeError=DerivedConstructorResult name="Derived"
// CHECK-NEXT: Throw v28
// CHECK-NEXT: b12(v29) frequency=Unlikely:
// CHECK-NEXT: v30 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v30
// CHECK-NEXT: }
