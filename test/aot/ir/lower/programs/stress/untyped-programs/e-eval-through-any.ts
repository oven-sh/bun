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
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = Builtin builtin=Process
// CHECK-NEXT: v3 = PropGet v2 key="argv"
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="length"
// CHECK-NEXT: v6 = Integer integer=99
// CHECK-NEXT: v7 = Greater v5, v6
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v8 = NewClosure function=[[f_2]]
// CHECK-NEXT: Jump -> next b4(v8)
// CHECK-NEXT: b3():
// CHECK-NEXT: v9 = Builtin builtin=GlobalThis
// CHECK-NEXT: v10 = PropGet v9 key="eval" [isFreeName]
// CHECK-NEXT: v11 = Convert v10 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = Builtin builtin=GlobalThis
// CHECK-NEXT: v14 = PropGet v13 key="console" [isFreeName]
// CHECK-NEXT: v15 = Convert v14 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="log"
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v18 = Convert v12 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v19 = Builtin builtin=Process
// CHECK-NEXT: v20 = PropGet v19 key="argv"
// CHECK-NEXT: v21 = Convert v20 declared={type=builtin(ProcessArgv) flags=[IsExpected]}
// CHECK-NEXT: v22 = PropGet v21 key="length"
// CHECK-NEXT: v23 = Integer integer=99
// CHECK-NEXT: v24 = Greater v22, v23
// CHECK-NEXT: Branch v24 -> taken b5(), notTaken b6()
// CHECK-NEXT: b5():
// CHECK-NEXT: v25 = String string="0"
// CHECK-NEXT: Jump -> next b7(v25)
// CHECK-NEXT: b6():
// CHECK-NEXT: v26 = String string="1 + 2"
// CHECK-NEXT: Jump -> next b7(v26)
// CHECK-NEXT: b7(v27):
// CHECK-NEXT: v28 = Call v1, -, v18, v27 calleeName="run"
// CHECK-NEXT: v29 = Call v17, v15, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v30 = Undefined
// CHECK-NEXT: Return v30
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="run"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[f_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_3]], v1: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="callback"
// CHECK-NEXT: ReturnCall v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
