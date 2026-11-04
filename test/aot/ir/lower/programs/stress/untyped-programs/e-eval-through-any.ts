// RUN: lower
// OPTIONS: builtin-modules

// Untyped programs: e eval through any. It prints what plain Bun prints.
type Callback = (text: string) => unknown;
function run(callback: Callback, text: string): unknown {
  return callback(text);
}
const loose: any = process.argv.length > 99 ? (text: string) => text.length : eval;
console.log(run(loose, process.argv.length > 99 ? "0" : "1 + 2"));

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]}
// CHECK-NEXT: v2 = Builtin builtin=Process
// CHECK-NEXT: v3 = PropGet v2 key="argv"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: v6 = Integer integer=99
// CHECK-NEXT: v7 = Greater v5, v6
// CHECK-NEXT: Branch v7 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v8 = NewClosure function=[[f_2]]
// CHECK-NEXT: Jump -> next b3(v8)
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="eval" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = Builtin builtin=Process
// CHECK-NEXT: v19 = PropGet v18 key="argv"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v21 = PropGet v20 key="length"
// CHECK-NEXT: v22 = Integer integer=99
// CHECK-NEXT: v23 = Greater v21, v22
// CHECK-NEXT: Branch v23 -> taken b4(), notTaken b5()
// CHECK-NEXT: b4():
// CHECK-NEXT: v24 = String string="0"
// CHECK-NEXT: Jump -> next b6(v24)
// CHECK-NEXT: b5():
// CHECK-NEXT: v25 = String string="1 + 2"
// CHECK-NEXT: Jump -> next b6(v25)
// CHECK-NEXT: b6(v26):
// CHECK-NEXT: v27 = Call v1, -, v12, v26 calleeName="run"
// CHECK-NEXT: v28 = Call v17, v15, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_3]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_3]], v1: undefined|null|string):
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="callback"
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
