// RUN: lower
// OPTIONS: builtin-modules

// A closure in a computed member name does not see a function that the member's body declares.
declare const console: { log(...a: unknown[]): void };
function k() { return "outer"; }
let g = () => "";
class C { [(g = () => k(), "m")]() { function k() { return "inner"; } } }
console.log(g());

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[f_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = NewClosure function=[[f_3]]
// CHECK-NEXT: v3 = NewClass v2 layout=[[L_4]]
// CHECK-NEXT: PutModuleVariable v3 variable=[[g_5]]
// CHECK-NEXT: v5 = NewClosure function=[[f_6]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[f_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = String string="m"
// CHECK-NEXT: v8 = ToPropertyKey v7
// CHECK-NEXT: v9 = NewClosure function=[[f_7]]
// CHECK-NEXT: SetFunctionName v9, v8
// CHECK-NEXT: DefineMethod v3, v9, v8 layout=[[L_4]]
// CHECK-NEXT: v12 = FinishClass v3 layout=[[L_4]]
// CHECK-NEXT: v13 = Convert v12 declared={type=[[f_3]] flags=[IsFromCompiler]}
// CHECK-NEXT: v14 = Convert v12 declared={type=[[f_3]] flags=[IsFromCompiler]}
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = Call v6 calleeName="g"
// CHECK-NEXT: v21 = Call v19, v17, v20 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="k"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="outer"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string=""
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="C"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="g"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v1 = Call v0 calleeName="k"
// CHECK-NEXT: ReturnCall v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Undefined
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="k"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewRuntimeError runtimeError=LeftOutOfExecutable name="k"
// CHECK-NEXT: Throw v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
