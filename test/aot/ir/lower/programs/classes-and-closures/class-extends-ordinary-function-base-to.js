// RUN: lower
// OPTIONS: builtin-modules

// A class extends an ordinary function: the function stores to this and has methods on its prototype object.
function Base(size) { this.size = size; }
Base.prototype.area = function () { return this.size * this.size; };
class Square extends Base {
  label = "square";
  constructor(size) { super(size); this.extra = size + 1; }
  describe() { return this.label + this.area() + this.extra; }
}
const made = new Square(3);
console.log(made.describe(), JSON.stringify(made), Object.keys(made).join(), made instanceof Base, made.constructor === Square);

// GENERATED: Base Square describe
// CHECK-LABEL: function {{*}}name="Base"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 thisType={type=[[L_1]] flags=[IsExpected]} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: PropSet v2, v1 key="size"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Square"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v6 = SuperConstruct v4, v1, v5 layout=[[L_3]]
// CHECK-NEXT: v7 = Convert v6 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b12(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: v10 = CallDirect v7 function=[[f_4]]
// CHECK-NEXT: v11 = TypeTest v7 testedType=absent
// CHECK-NEXT: Branch v11 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v12) frequency=Unlikely:
// CHECK-NEXT: v13 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v16 = Integer integer=1
// CHECK-NEXT: v17 = Add v5, v16
// CHECK-NEXT: PropSet v15, v17 key="extra"
// CHECK-NEXT: v19 = Undefined
// CHECK-NEXT: v20 = TypeTest v19 testedType=object
// CHECK-NEXT: Branch v20 -> taken b5(| 0), notTaken b6(| 0)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: Jump -> next b10(v21)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: v23 = TypeTest v22 testedType=undefined
// CHECK-NEXT: Branch v23 -> taken b7(| 0), notTaken b11(| 0)
// CHECK-NEXT: b7(v24):
// CHECK-NEXT: v25 = TypeTest v14 testedType=absent
// CHECK-NEXT: Branch v25 -> taken b8(| 0), notTaken b9(| 0)
// CHECK-NEXT: b8(v26) frequency=Unlikely:
// CHECK-NEXT: v27 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v27
// CHECK-NEXT: b9(v28):
// CHECK-NEXT: Jump -> next b10(v28)
// CHECK-NEXT: b10(v29):
// CHECK-NEXT: Return v29
// CHECK-NEXT: b11(v30) frequency=Unlikely:
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=DerivedConstructorResult name="Square"
// CHECK-NEXT: Throw v31
// CHECK-NEXT: b12(v32) frequency=Unlikely:
// CHECK-NEXT: v33 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v33
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_3]] flags=[IsExpected]} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: [[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v2 = PropGet v1 key="label"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v4 = Convert v0 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="area"
// CHECK-NEXT: v6 = Call v5, v4 calleeKey="area" calleeName="this.area"
// CHECK-NEXT: v7 = Add v3, v6
// CHECK-NEXT: v8 = Convert v0 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v8 key="extra"
// CHECK-NEXT: v10 = Add v7, v9
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
