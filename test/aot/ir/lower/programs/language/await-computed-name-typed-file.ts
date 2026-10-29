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
// CHECK-NEXT: v0 = NewDictionary
// CHECK-NEXT: v1 = NewClosure function=[[f_1]]
// CHECK-NEXT: v2 = Call v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v4 = Await v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v6 = ToPropertyKey v5
// CHECK-NEXT: v7 = Integer integer=1
// CHECK-NEXT: v8 = Convert v7 declared={type=number site=[[w_3]]}
// CHECK-NEXT: ElemDefine v0, v6, v8
// CHECK-NEXT: v10 = NewClosure function=[[f_4]]
// CHECK-NEXT: v11 = String string="b"
// CHECK-NEXT: v12 = Call v10, -, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v14 = Await v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v16 = ToPropertyKey v15
// CHECK-NEXT: v17 = Integer integer=2
// CHECK-NEXT: v18 = Convert v17 declared={type=number site=[[w_3]]}
// CHECK-NEXT: ElemDefine v0, v16, v18
// CHECK-NEXT: v20 = Convert v0 declared={type=undefined|null|object site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v21 = Builtin builtin=GlobalThis
// CHECK-NEXT: v22 = PropGet v21 key="console" [isFreeName]
// CHECK-NEXT: v23 = Convert v22 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v24 = PropGet v23 key="log"
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v26 = Builtin builtin=JSON
// CHECK-NEXT: v27 = PropGet v26 key="stringify"
// CHECK-NEXT: v28 = Convert v27 declared={type=builtin(JSONStringify) flags=[IsExpected]}
// CHECK-NEXT: v29 = Call v28, v26, v20 calleeKey="stringify" calleeName="JSON.stringify"
// CHECK-NEXT: v30 = Convert v29 declared={type=undefined|null|string site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: v31 = Call v25, v23, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = String string="a"
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string|object site=[[w_8]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsAsync, IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|Promise<undefined|null|string> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|string|object site=[[w_10]]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
