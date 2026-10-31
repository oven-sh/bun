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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[f_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[f_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ResolveHeritage v0
// CHECK-NEXT: v2 = NewClosure function=[[f_5]]
// CHECK-NEXT: v3 = NewClass v2, v0, v1 layout=[[L_6]]
// CHECK-NEXT: v4 = NewClosure function=[[f_7]]
// CHECK-NEXT: DefineMethod v3, v4 layout=[[L_6]] key="twice"
// CHECK-NEXT: v6 = FinishClass v3 layout=[[L_6]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[f_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = Convert v6 declared={type=[[f_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|number site=[[w_8]]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_10]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_10]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_10]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_11]]
// CHECK-NEXT: v6 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Jump -> next b5(v9)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_12]]}
// CHECK-NEXT: PropSet v4, v12 key="y"
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: v15 = TypeTest v14 testedType=object
// CHECK-NEXT: Branch v15 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v16):
// CHECK-NEXT: Jump -> next b8(v16)
// CHECK-NEXT: b7(v17):
// CHECK-NEXT: Jump -> next b8(v4)
// CHECK-NEXT: b8(v18):
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_10]] site=[[w_13]]} results=[{type=number site=[[w_14]]}] {
// CHECK-NEXT: b0(v0: [[L_10]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_14]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="name"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="derived"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Middle"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_6]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_6]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_17]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_6]] site=[[w_18]]} results=[{type=number site=[[w_19]]}] {
// CHECK-NEXT: b0(v0: [[L_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="sum"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="sum" calleeName="this.sum"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_20]]}
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Mul v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_19]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
