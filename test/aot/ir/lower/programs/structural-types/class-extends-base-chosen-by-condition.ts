// RUN: lower
// OPTIONS: builtin-modules

// A class extends a base chosen by a condition.
class Base {
  x = 1;
  y: number;
  constructor(y: number = 2) {
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
}

const Alias = Base;
const flag = [1].length === 1;

class Derived extends (flag ? Base : Alias) {
  extra = "d";
  twice(): number {
    return this.sum() * 2;
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

// GENERATED: Base sum Derived twice
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=undefined|number site=[[w_1]]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_4]]
// CHECK-NEXT: v6 = TypeTest v1 testedType=undefined
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = Integer integer=2
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_1]]}
// CHECK-NEXT: Jump -> next b5(v9)
// CHECK-NEXT: b4(v10):
// CHECK-NEXT: Jump -> next b5(v10)
// CHECK-NEXT: b5(v11):
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_5]]}
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
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_3]] site=[[w_6]]} results=[{type=number site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_9]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_9]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_10]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_9]] site=[[w_11]]} results=[{type=number site=[[w_12]]}] {
// CHECK-NEXT: b0(v0: [[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="sum"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="sum" calleeName="this.sum"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_13]]}
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Mul v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_12]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
