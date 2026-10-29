// RUN: lower
// OPTIONS: builtin-modules

// The parent of a subclass of a regexp subclass is replaced by a constructor function.
class B extends RegExp {}
class C extends B {}
const X = function () {};
Object.defineProperty(X.prototype, "exec", {
  value: function (text) {
    return null;
  },
});
X.prototype.__proto__ = RegExp.prototype;
C.__proto__ = X;
console.log(new B("a").test("a"));

// GENERATED: B X value
// CHECK-LABEL: function {{*}}name="B"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_2]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_2]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="X"
// CHECK: module=[[m_0]] position={{*}} text={{*}} thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="value"
// CHECK: module=[[m_0]] position={{*}} text={{*}} length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=null flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Null
// CHECK-NEXT: v2 = Convert v1 declared={type=null flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
