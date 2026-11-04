// RUN: lower
// OPTIONS: builtin-modules

// A file without `import` and `export` is a module too: `await (` in a computed name at its top level is the operator.
const keyed = { [await (async () => "a")()]: 1, [(await (async (text: string) => text)("b"))]: 2 };
console.log(JSON.stringify(keyed));

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Call v0
// CHECK-NEXT: v2 = Await v1
// CHECK-NEXT: v3 = ToPropertyKey v2
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = NewObject layout=[[L_2]]
// CHECK-NEXT: ElemDefine v5, v3, v4
// CHECK-NEXT: v7 = NewClosure function=[[f_3]]
// CHECK-NEXT: v8 = String string="b"
// CHECK-NEXT: v9 = Call v7, -, v8
// CHECK-NEXT: v10 = Await v9
// CHECK-NEXT: v11 = ToPropertyKey v10
// CHECK-NEXT: v12 = Integer integer=2
// CHECK-NEXT: ElemDefine v5, v11, v12
// CHECK-NEXT: v14 = FinishObject v5
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = Builtin builtin=JSON
// CHECK-NEXT: v21 = PropGet v20 key="stringify"
// CHECK-NEXT: v22 = Convert v21 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v23 = Call v22, v20, v14 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v25 = Call v19, v17, v24 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v26 = Undefined
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = String string="a"
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
