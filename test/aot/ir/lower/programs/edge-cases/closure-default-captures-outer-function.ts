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
// CHECK-NEXT: v0 = Builtin builtin=GlobalThis
// CHECK-NEXT: v1 = PropGet v0 key="console" [isFreeName]
// CHECK-NEXT: v2 = Convert v1 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="log"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v5 = NewClosure function=[[f_1]]
// CHECK-NEXT: v6 = Call v5
// CHECK-NEXT: v7 = Call v4, v2, v6 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="outer"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} parameters=[{type=undefined|null|[[f_2]] flags=[OmitsNull]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_2]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NewClosure function=[[f_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b3(v4)
// CHECK-NEXT: b2(v5):
// CHECK-NEXT: Jump -> next b3(v5)
// CHECK-NEXT: b3(v6):
// CHECK-NEXT: v7 = Call v6 calleeName="cb"
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="cb"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = Call v0 calleeName="g"
// CHECK-NEXT: ReturnCall v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewRuntimeError runtimeError=LeftOutOfExecutable name="g"
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
