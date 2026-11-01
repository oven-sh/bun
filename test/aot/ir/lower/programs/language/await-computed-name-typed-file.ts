// RUN: lower
// OPTIONS: builtin-modules

// A file without `import` and `export` is a module too: `await (` in a computed name at its top level is the operator.
const keyed = { [await (async () => "a")()]: 1, [(await (async (text: string) => text)("b"))]: 2 };
console.log(JSON.stringify(keyed));

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Call v0
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v3 = Await v2
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v5 = ToPropertyKey v4
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_3]]}
// CHECK-NEXT: v8 = NewObject layout=[[L_4]]
// CHECK-NEXT: ElemDefine v8, v5, v7
// CHECK-NEXT: v10 = NewClosure function=[[f_5]]
// CHECK-NEXT: v11 = String string="b"
// CHECK-NEXT: v12 = Call v10, -, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v14 = Await v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v16 = ToPropertyKey v15
// CHECK-NEXT: v17 = Integer integer=2
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_3]]}
// CHECK-NEXT: ElemDefine v8, v16, v18
// CHECK-NEXT: v20 = FinishObject v8
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|object site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="console" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v25 = PropGet v24 key="log"
// CHECK-NEXT: v26 = Convert v25 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v27 = Builtin builtin=JSON
// CHECK-NEXT: v28 = PropGet v27 key="stringify"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v30 = Call v29, v27, v21 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v32 = Call v26, v24, v31 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="a"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string|object site=[[w_9]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string|object site=[[w_11]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
