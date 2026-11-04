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
// CHECK-NEXT: PropSet v0, v1 key="size"
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Square"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: anything):
// CHECK-NEXT: v3 = Absent
// CHECK-NEXT: v4 = GetSuperBase v0
// CHECK-NEXT: v5 = SuperConstruct v4, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v6 = Convert v5 declared={type=[[L_2]]}
// CHECK-NEXT: v7 = TypeTest v3 testedType=absent
// CHECK-NEXT: Branch v7 -> taken b1(| 0), notTaken b11(| 0)
// CHECK-NEXT: b1(v8):
// CHECK-NEXT: v9 = CallDirect v6 function=[[f_3]]
// CHECK-NEXT: v10 = TypeTest v6 testedType=absent
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: v12 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b3(v13):
// CHECK-NEXT: v14 = Integer integer=1
// CHECK-NEXT: v15 = Add v2, v14
// CHECK-NEXT: PropSet v13, v15 key="extra"
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: v18 = TypeTest v17 testedType=object
// CHECK-NEXT: Branch v18 -> taken b4(| 0), notTaken b5(| 0)
// CHECK-NEXT: b4(v19):
// CHECK-NEXT: Jump -> next b9(v19)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: v21 = TypeTest v20 testedType=undefined
// CHECK-NEXT: Branch v21 -> taken b6(| 0), notTaken b10(| 0)
// CHECK-NEXT: b6(v22):
// CHECK-NEXT: v23 = TypeTest v13 testedType=absent
// CHECK-NEXT: Branch v23 -> taken b7(| 0), notTaken b8(| 0)
// CHECK-NEXT: b7(v24):
// CHECK-NEXT: v25 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v25
// CHECK-NEXT: b8(v26):
// CHECK-NEXT: Jump -> next b9(v26)
// CHECK-NEXT: b9(v27):
// CHECK-NEXT: Return v27
// CHECK-NEXT: b10(v28):
// CHECK-NEXT: v29 = NewRuntimeError runtimeError=DerivedConstructorResult name="Square"
// CHECK-NEXT: Throw v29
// CHECK-NEXT: b11(v30):
// CHECK-NEXT: v31 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] thisType={type=[[L_2]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_2]]):
// CHECK-NEXT: v1 = PropGet v0 key="label"
// CHECK-NEXT: v2 = PropGet v0 key="area"
// CHECK-NEXT: v3 = Call v2, v0 calleeKey="area" calleeName="this.area"
// CHECK-NEXT: v4 = Add v1, v3
// CHECK-NEXT: v5 = PropGet v0 key="extra"
// CHECK-NEXT: v6 = Add v4, v5
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
