// RUN: lower
// OPTIONS: builtin-modules

// A class that extends null returns an object of its own.
class Bare extends null {
  constructor() {
    return Object.create(new.target.prototype);
  }
  hello(): string {
    return "a method of the bare class";
  }
}

const made = new Bare();
console.log(made.hello());
console.log("instance: " + (made instanceof Bare) + " " + (made instanceof Object));
console.log("has toString: " + ("toString" in made));
console.log("keys: [" + Object.keys(made).join(" ") + "]");

// GENERATED: Bare hello
// CHECK-LABEL: function {{*}}name="Bare"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Absent
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectCreate
// CHECK-NEXT: v4 = PropGet v0 key="prototype"
// CHECK-NEXT: v5 = Call v3, v2, v4 calleeName="Object.create"
// CHECK-NEXT: v6 = TypeTest v5 testedType=object
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b7(v7)
// CHECK-NEXT: b3(v8):
// CHECK-NEXT: v9 = TypeTest v8 testedType=undefined
// CHECK-NEXT: Branch v9 -> taken b4(| 0), notTaken b8(| 0)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: v11 = TypeTest v1 testedType=absent
// CHECK-NEXT: Branch v11 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v12) frequency=Unlikely:
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b6(v14):
// CHECK-NEXT: Jump -> next b7(v14)
// CHECK-NEXT: b7(v15):
// CHECK-NEXT: Return v15
// CHECK-NEXT: b8(v16) frequency=Unlikely:
// CHECK-NEXT: v17 = NewRuntimeError runtimeError=DerivedConstructorResult name="Bare"
// CHECK-NEXT: Throw v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hello"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="a method of the bare class"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
