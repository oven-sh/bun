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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_2]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = PropGet v0 key="count"
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v0, v7 key="count"
// CHECK-NEXT: v9 = PropGet v0 key="names"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v11 = PropGet v10 key="push"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v0 key="name"
// CHECK-NEXT: v14 = Convert v13 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v15 = Call v12, v10, v14 calleeKey="push" calleeName="push"
// CHECK-NEXT: v16 = Convert v3 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="constructor"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v19 = Convert v3 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="constructor"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="total"
// CHECK-NEXT: v23 = TypeTest v22 testedType=undefined|null
// CHECK-NEXT: Branch v23 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v24):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v25 = Integer
// CHECK-NEXT: Jump -> next b5(v25)
// CHECK-NEXT: b4(v26):
// CHECK-NEXT: Jump -> next b5(v26)
// CHECK-NEXT: b5(v27):
// CHECK-NEXT: v28 = Integer integer=1
// CHECK-NEXT: v29 = Add v27, v28
// CHECK-NEXT: PropSet v18, v29 key="total"
// CHECK-NEXT: v31 = Convert v3 declared={type=undefined|null|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v0 key="count"
// CHECK-NEXT: v33 = Convert v32 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v31, v33 key="n"
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: v36 = TypeTest v35 testedType=object
// CHECK-NEXT: Branch v36 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v37):
// CHECK-NEXT: Jump -> next b8(v37)
// CHECK-NEXT: b7(v38):
// CHECK-NEXT: Jump -> next b8(v3)
// CHECK-NEXT: b8(v39):
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
