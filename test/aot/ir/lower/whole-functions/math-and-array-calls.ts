// RUN: lower

export function largest(values: number[]): number {
  return Math.max(values.length, values.indexOf(0));
}

// GENERATED: largest
// CHECK-LABEL: function {{*}}name="largest"
// CHECK: module=[[m_0]] position={{*}} sourceRange={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<number> flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<number>):
// CHECK-NEXT: v1 = Builtin builtin=Math
// CHECK-NEXT: v2 = Builtin builtin=MathMax
// CHECK-NEXT: v3 = PropGet v0 key="length"
// CHECK-NEXT: v4 = PropGet v0 key="indexOf"
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = Call v4, v0, v5 calleeKey="indexOf" calleeName="values.indexOf"
// CHECK-NEXT: v7 = Convert v6 declared={type=number} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v8 = Call v2, v1, v3, v7 calleeName="Math.max"
// CHECK-NEXT: ReturnCall v8 casts=[{declared={type=number}}, {declared={type=number}}]
// CHECK-NEXT: }
