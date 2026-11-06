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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=boolean site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="get"
// CHECK-NEXT: v2 = TypeTest v1 testedType=function
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_2]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="tell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = NewClosure v0 function=[[f_6]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_7]] site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Call v2
// CHECK-NEXT: ReturnCall v3 casts=[{declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="once"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] captures=[{type=undefined|null|[[L_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_7]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="d"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v4 = Call v3, -, v2 calleeName="guard"
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean site=[[w_12]]}
// CHECK-NEXT: v6 = ToBoolean v5
// CHECK-NEXT: Branch v6 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v8 = String string="get "
// CHECK-NEXT: v9 = Convert v2 declared={type=undefined|null|[[L_1]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = PropGet v9 key="get"
// CHECK-NEXT: v11 = Call v10, v9 calleeKey="get" calleeName="s.get"
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b4(v14):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v15 = String string="none "
// CHECK-NEXT: v16 = PropGet v2 key="value"
// CHECK-NEXT: v17 = Add v15, v16
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: }
