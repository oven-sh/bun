// RUN: lower
// OPTIONS: builtin-modules

// A value that was checked against its type where it was created keeps that type although a type guard later narrows a variable for it to another type.
type Child = { d: PropertyDescriptor | null }
type Alike = { get: () => string }
function guard(d: PropertyDescriptor): d is PropertyDescriptor & { get(): string } { return typeof d.get === "function" }
function tell(child: Child): string {
  const once = () => {
    const s = child.d!
    if (guard(s)) { return "get " + s.get() } else { return "none " + s.value }
  }
  return once()
}
const alike = JSON.parse('{}') as Alike
const given = JSON.parse('{"d":{"value":"v"}}') as Child
console.log(typeof alike.get, tell(given), tell({ d: { get: () => "g" } }))

// GENERATED: guard tell once
// CHECK-LABEL: function {{*}}name="guard"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="get"
// CHECK-NEXT: v2 = TypeTest v1 testedType=function
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: v1 = CallDirect v0 function=[[f_3]]
// CHECK-NEXT: ReturnCall v1 casts=[{declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="once"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|[[L_2]] flags=[OmitsNull, OmitsUndefined] variableName="child"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_2]]):
// CHECK-NEXT: v1 = PropGet v0 key="d"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = Call v2, -, v1 calleeName="guard"
// CHECK-NEXT: v4 = ToBoolean v3
// CHECK-NEXT: Branch v4 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v5):
// CHECK-NEXT: v6 = String string="get "
// CHECK-NEXT: v7 = PropGet v1 key="get"
// CHECK-NEXT: v8 = Call v7, v1 calleeKey="get" calleeName="s.get"
// CHECK-NEXT: v9 = Add v6, v8
// CHECK-NEXT: Return v9
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: v11 = String string="none "
// CHECK-NEXT: v12 = PropGet v1 key="value"
// CHECK-NEXT: v13 = Add v11, v12
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
