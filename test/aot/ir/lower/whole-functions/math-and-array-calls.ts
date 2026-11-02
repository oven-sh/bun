// RUN: lower

export function largest(values: number[]): number {
  return Math.max(values.length, values.indexOf(0));
}

// GENERATED: largest
// CHECK-LABEL: function {{*}}name="largest"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Math
// CHECK-NEXT: v2 = Builtin builtin=MathMax
// CHECK-NEXT: v3 = PropGet v0 key="length"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_3]]} illTypedCause=Assertion
// CHECK-NEXT: v5 = PropGet v0 key="indexOf"
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = Call v5, v0, v6 calleeKey="indexOf" calleeName="values.indexOf"
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_4]]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v9 = Call v2, v1, v4, v8 calleeName="Math.max"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=number site=[[w_5]]}}, {declared={type=number site=[[w_2]]}}]
// CHECK-NEXT: }
