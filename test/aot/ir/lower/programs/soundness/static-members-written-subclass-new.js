// RUN: lower
// OPTIONS: builtin-modules

// Static members written through the subclass that is new target.
class A {
  static count = 0;
  static names = [];
  constructor() {
    new.target.count += 1;
    new.target.names.push(new.target.name);
    this.constructor.total = (this.constructor.total ?? 0) + 1;
    this.n = new.target.count;
  }
}
class B extends A {}
const list = [new A(), new B(), new B(), new A()];
console.log(list.map(o => o.n).join());
console.log(A.count, B.count, Object.hasOwn(B, "count"), Object.hasOwn(B, "names"), A.names.join());
console.log(A.total, B.total, Object.hasOwn(B, "total"));

// GENERATED: A B
// CHECK-LABEL: function {{*}}name="A"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]]}
// CHECK-NEXT: v4 = PropGet v0 key="count"
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: PropSet v0, v6 key="count"
// CHECK-NEXT: v8 = PropGet v0 key="names"
// CHECK-NEXT: v9 = PropGet v8 key="push"
// CHECK-NEXT: v10 = PropGet v0 key="name"
// CHECK-NEXT: v11 = Call v9, v8, v10 calleeKey="push" calleeName="push"
// CHECK-NEXT: v12 = PropGet v3 key="constructor"
// CHECK-NEXT: v13 = PropGet v3 key="constructor"
// CHECK-NEXT: v14 = PropGet v13 key="total"
// CHECK-NEXT: v15 = TypeTest v14 testedType=undefined|null
// CHECK-NEXT: Branch v15 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v16):
// CHECK-NEXT: v17 = Integer
// CHECK-NEXT: Jump -> next b3(v17)
// CHECK-NEXT: b2(v18):
// CHECK-NEXT: Jump -> next b3(v18)
// CHECK-NEXT: b3(v19):
// CHECK-NEXT: v20 = Integer integer=1
// CHECK-NEXT: v21 = Add v19, v20
// CHECK-NEXT: PropSet v12, v21 key="total"
// CHECK-NEXT: v23 = PropGet v0 key="count"
// CHECK-NEXT: PropSet v3, v23 key="n"
// CHECK-NEXT: v25 = Undefined
// CHECK-NEXT: v26 = TypeTest v25 testedType=object
// CHECK-NEXT: Branch v26 -> taken b4(| 0), notTaken b5(v3)
// CHECK-NEXT: b4(v27):
// CHECK-NEXT: Jump -> next b5(v27)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Return v28
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_4]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_4]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
