// RUN: lower
// OPTIONS: builtin-modules

// @ts-nocheck
function first(this, x) {}
function alone(this: any) {
  return this;
}
class Holder {
  method(this: Holder, x, y) {
    return [this instanceof Holder, x, y];
  }
}
const expression = function (this, x) {};
console.log(first.length, alone.length, Holder.prototype.method.length, expression.length);
console.log(alone.call(7), new Holder().method(1, 2));
console.log(String(first));

// GENERATED: first Holder method
// CHECK-LABEL: function {{*}}name="first"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="method"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, HasExplicitName] length=2 thisType={type=undefined|null|[[L_1]] flags=[IsExpected]} parameters=[{type=anything}, {type=anything}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: anything, v2: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="Holder"
// CHECK-NEXT: v5 = InstanceOf v0, v4 writtenExpression="this instanceof Holder"
// CHECK-NEXT: v6 = NewArray v5, v1, v2 contents=anything
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
