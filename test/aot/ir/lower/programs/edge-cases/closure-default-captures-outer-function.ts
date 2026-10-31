// RUN: lower
// OPTIONS: builtin-modules

// A closure in the default of a parameter does not see a function that the body declares.
declare const console: { log(...a: unknown[]): void };
function g() { return "outer"; }
console.log(((cb = () => g()) => { function g() { return "inner"; } return cb(); })());

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = NewClosure function=[[f_1]]
// CHECK-NEXT: v6 = Call v5
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = Call v4, v2, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="outer"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} parameters=[{type=undefined|null|[[f_4]] site=[[w_5]] flags=[OmitsNull]}] results=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v3 = NewClosure function=[[f_7]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b5(v4)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5(v5)
// CHECK-NEXT: b5(v6):
// CHECK-NEXT: v7 = NewClosure function=[[f_8]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[f_8]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = Call v6 calleeName="cb"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="cb"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v1 = Call v0 calleeName="g"
// CHECK-NEXT: ReturnCall v1 casts=[{declared={type=undefined|null|string site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}}, {declared={type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="inner"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
