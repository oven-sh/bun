// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesChecked = 4

// FILE: main.ts
// The function that `forEach` calls stores to the list through its third parameter. `import()` gets the names.
const names = ["A", "B"];
names.forEach((name, index, list) => {
  list[index] = name.toLowerCase();
});
for (const name of names) console.log((await import("./lib/" + name + ".ts")).who);

// FILE: lib/a.ts
export const who: string = "lib/a";

// FILE: lib/b.ts
export const who: string = "lib/b";

// FILE: lib/c.ts
export const who: string = "lib/c";

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module flags=[IsAsync, IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<undefined|null|string> site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v2 = PropGet v1 key="forEach"
// CHECK-NEXT: v3 = NewClosure function=[[f_3]]
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="forEach" calleeName="names.forEach"
// CHECK-NEXT: v5 = IteratorOpen v1
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v5
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v10 = Undefined
// CHECK-NEXT: Return v10
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b11():
// CHECK-NEXT: v11 = Convert v9 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = String string="./lib/"
// CHECK-NEXT: v18 = Add v17, v11
// CHECK-NEXT: v19 = String string=".ts"
// CHECK-NEXT: v20 = Add v18, v19
// CHECK-NEXT: SwitchString v20 strings=["./lib/a.ts", "./lib/b.ts", "./lib/c.ts"] -> case b6(), case b7(), case b8(), otherwise b9()
// CHECK-NEXT: b6() handler=b11():
// CHECK-NEXT: v21 = ImportModule module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v21)
// CHECK-NEXT: b7() handler=b11():
// CHECK-NEXT: v22 = ImportModule module=[[m_6]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v22)
// CHECK-NEXT: b8() handler=b11():
// CHECK-NEXT: v23 = ImportModule module=[[m_7]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v23)
// CHECK-NEXT: b9() handler=b11():
// CHECK-NEXT: v24 = ImportDynamic v20 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b10(v24)
// CHECK-NEXT: b10(v25) handler=b11():
// CHECK-NEXT: v26 = Await v25
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="who"
// CHECK-NEXT: v29 = Call v16, v14, v28 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b11() role=IterationCleanup subject=v5:
// CHECK-NEXT: v30 = CatchException
// CHECK-NEXT: IteratorClose v5 completion=Throw
// CHECK-NEXT: Rethrow v30
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=3 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_10]]}, {type=undefined|null|Array<undefined|null|string> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number, v2: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = PropGet v0 key="toLowerCase"
// CHECK-NEXT: v4 = Call v3, v0 calleeKey="toLowerCase" calleeName="name.toLowerCase"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: ElemSet v2, v1, v5
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_14]]]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
