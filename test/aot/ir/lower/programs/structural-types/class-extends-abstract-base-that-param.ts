// RUN: lower
// OPTIONS: builtin-modules

// A class extends an abstract base that is a parameter.
abstract class Base {
  x = 1;
  y: number;
  constructor(y: number = 2) {
    this.y = y;
  }
  abstract name(): string;
  sum(): number {
    return this.x + this.y;
  }
}

function derive(Parent: abstract new (y?: number) => Base) {
  abstract class Middle extends Parent {
    extra = "d";
    twice(): number {
      return this.sum() * 2;
    }
  }
  return Middle;
}

class Derived extends derive(Base) {
  name(): string {
    return "derived";
  }
}

const made = new Derived();
console.log("keys: " + Object.keys(made).join(" "));
console.log("json: " + JSON.stringify(made));
console.log("members: " + made.x + " " + made.y + " " + made.extra + " " + made.sum() + " " + made.twice());
console.log("kinds: " + typeof made.x + " " + typeof made.y + " " + typeof made.extra);
console.log("instance: " + (made instanceof Derived) + " " + (made instanceof Base));
made.x = 10;
made.extra = "stored";
console.log("after stores: " + JSON.stringify(made) + " " + made.sum());

// GENERATED: derive Base sum name Middle twice
// CHECK-LABEL: function {{*}}name="derive"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: v1 = ResolveHeritage v0
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = NewClass v2, v0, v1 layout=[[L_3]]
// CHECK-NEXT: v4 = NewClosure function=[[f_4]]
// CHECK-NEXT: DefineMethod v3, v4 layout=[[L_3]] key="twice"
// CHECK-NEXT: v6 = FinishClass v3 layout=[[L_3]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[f_2]] flags=[IsFromCompiler]}
// CHECK-NEXT: v8 = Convert v6 declared={type=[[f_2]] flags=[IsFromCompiler]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|number}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|number):
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_5]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_5]]}
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_6]]
// CHECK-NEXT: v6 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v6 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v7):
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: v9 = Convert v8 declared={type=number}
// CHECK-NEXT: Jump -> next b3(v9)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b3(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: PropSet v4, v11 key="y"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: v14 = TypeTest v13 testedType=object
// CHECK-NEXT: Branch v14 -> taken b4(| 0), notTaken b5(v4)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Jump -> next b5(v15)
// CHECK-NEXT: b5(v16):
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_5]]} results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_5]]):
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="name"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="derived"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Middle"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_9]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_3]]} results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: v1 = PropGet v0 key="sum"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="sum" calleeName="this.sum"
// CHECK-NEXT: v3 = Integer integer=2
// CHECK-NEXT: v4 = Mul v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
