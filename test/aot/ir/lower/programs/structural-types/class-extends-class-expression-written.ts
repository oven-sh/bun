// RUN: lower
// OPTIONS: builtin-modules

// A class extends a class expression written in place.
class Derived extends class {
  x = 1;
  y: number;
  constructor(y: number = 2) {
    this.y = y;
  }
  sum(): number {
    return this.x + this.y;
  }
} {
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
console.log("instance: " + (made instanceof Derived) + " " + (made instanceof Derived));
made.x = 10;
made.extra = "stored";
console.log("after stores: " + JSON.stringify(made) + " " + made.sum());

// GENERATED: sum Derived twice
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_1]] site=[[w_2]]} results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: [[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = PropGet v0 key="y"
// CHECK-NEXT: v3 = Add v1, v2
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Derived"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_6]]
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="twice"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_5]] site=[[w_7]]} results=[{type=number site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: [[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="sum"
// CHECK-NEXT: v2 = Call v1, v0 calleeKey="sum" calleeName="this.sum"
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v4 = Integer integer=2
// CHECK-NEXT: v5 = Mul v3, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
