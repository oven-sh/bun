// RUN: lower
// OPTIONS: builtin-modules

// FILE: class-read-declaration-output-hashbang.mjs
#!/usr/bin/env bun
// @bun
// The first line that `bun build --target=bun` writes follows a hashbang, and a class is read above its declaration.
function attempt(read) {
  try {
    console.log(typeof read());
  } catch (error) {
    console.log(error.name);
  }
}
attempt(() => Late);
class Late {}
attempt(() => Late);

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: *
// CHECK: function {{*}}
// CHECK: module=[[m_0]] kind=Module thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = NewClosure function=[[f_1]]
// CHECK-NEXT: v1 = Convert v0 declared={type=[[f_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = Call v1, -, v2 calleeName="attempt"
// CHECK-NEXT: v4 = NewClosure function=[[f_3]]
// CHECK-NEXT: v5 = NewClass v4 layout=[[L_4]]
// CHECK-NEXT: PutModuleVariable v5 variable=[[g_5]]
// CHECK-NEXT: v7 = FinishClass v5 layout=[[L_4]]
// CHECK-NEXT: v8 = Convert v7 declared={type=[[f_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = Convert v7 declared={type=[[f_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: PutModuleVariable v9 variable=[[g_6]]
// CHECK-NEXT: v11 = NewClosure function=[[f_7]]
// CHECK-NEXT: v12 = Call v1, -, v11 calleeName="attempt"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="console" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="log"
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v6 = Call v0 calleeName="read"
// CHECK-NEXT: v7 = TypeOf v6
// CHECK-NEXT: v8 = Call v5, v3, v7 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="console" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v13 = PropGet v12 key="log"
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v9 key="name"
// CHECK-NEXT: v16 = Call v14, v12, v15 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v17 = Undefined
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|[[f_8]] flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Late"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Late"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_8]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow thisType={type=anything} results=[{type=undefined|null|[[f_8]] flags=[IsExpected]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="Late"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
// CHECK: function {{*}}
// CHECK: module=[[m_0]] role=Signature thisType={type=anything} results=[{type=anything}]
