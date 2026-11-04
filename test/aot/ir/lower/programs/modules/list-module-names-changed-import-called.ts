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
// CHECK-NEXT: v0 = Data data=[[d_1]]
// CHECK-NEXT: v1 = PropGet v0 key="forEach"
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = Call v1, v0, v2 calleeKey="forEach" calleeName="names.forEach"
// CHECK-NEXT: v4 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v6 = IteratorResume v4
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Branch v7 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b10():
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = String string="./lib/"
// CHECK-NEXT: v16 = Add v15, v8
// CHECK-NEXT: v17 = String string=".ts"
// CHECK-NEXT: v18 = Add v16, v17
// CHECK-NEXT: SwitchString v18 strings=["./lib/a.ts", "./lib/b.ts", "./lib/c.ts"] -> case b5(), case b6(), case b7(), otherwise b8()
// CHECK-NEXT: b5() handler=b10():
// CHECK-NEXT: v19 = ImportModule module=[[m_3]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b9(v19)
// CHECK-NEXT: b6() handler=b10():
// CHECK-NEXT: v20 = ImportModule module=[[m_4]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b9(v20)
// CHECK-NEXT: b7() handler=b10():
// CHECK-NEXT: v21 = ImportModule module=[[m_5]] referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b9(v21)
// CHECK-NEXT: b8() handler=b10():
// CHECK-NEXT: v22 = ImportDynamic v18 referrer=[[m_0]]
// CHECK-NEXT: Jump -> next b9(v22)
// CHECK-NEXT: b9(v23) handler=b10():
// CHECK-NEXT: v24 = Await v23
// CHECK-NEXT: v25 = PropGet v24 key="who"
// CHECK-NEXT: v26 = Call v14, v12, v25 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b10() role=IterationCleanup subject=v4:
// CHECK-NEXT: v27 = CatchException
// CHECK-NEXT: IteratorClose v4 completion=Throw
// CHECK-NEXT: Rethrow v27
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=3 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=number}, {type=undefined|null|Array<undefined|null|string> flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: number, v2: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: v3 = PropGet v0 key="toLowerCase"
// CHECK-NEXT: v4 = Call v3, v0 calleeKey="toLowerCase" calleeName="name.toLowerCase"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]} illTypedCause=DeclarationWithoutBody
// CHECK-NEXT: ElemSet v2, v1, v5
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
